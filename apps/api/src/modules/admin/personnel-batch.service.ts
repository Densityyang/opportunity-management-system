import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  PageResult,
  PersonnelAccountBatchItemView,
  PersonnelAccountBatchView,
  PersonnelDistrictRuleView,
} from "@oms/contracts";
import argon2 from "argon2";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { Response } from "express";
import type { AuthIdentity } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import { notFound } from "../../common/http-error";
import { initialPasswordFromPhone } from "../../common/initial-password";
import { PrismaService } from "../../common/prisma.service";
import {
  PersonnelAccountBatchItemStatus,
  PersonnelAccountBatchStatus,
  PersonnelSourceProfile,
  Prisma,
  RoleCode,
} from "../../generated/prisma/client";
import { AdministrationPolicyService } from "./admin-policy.service";
import {
  PersonnelAccountBatchItemQueryDto,
  PersonnelAccountBatchPreviewDto,
  PersonnelDistrictRuleDto,
} from "./personnel.dto";

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EXPORT_ROWS = 50_000;
const MOBILE_RE = /^1[3-9]\d{9}$/;

type Rule = {
  id: string;
  name: string;
  includeText: string;
  excludeText: string | null;
  priority: number;
  enabled: boolean;
  districtId: string;
  district: { id: string; name: string; enabled: boolean };
  updatedAt: Date;
};

type PersonForBatch = {
  id: string;
  personnelCode: string;
  name: string;
  personalPhoneCiphertext: string | null;
  personalPhoneIv: string | null;
  personalPhoneTag: string | null;
  personalPhoneBlindIndex: string | null;
  workPhoneCiphertext: string | null;
  workPhoneIv: string | null;
  workPhoneTag: string | null;
  workPhoneBlindIndex: string | null;
  organizationPath: string | null;
  firstLevelOrganization: string | null;
  secondLevelOrganization: string | null;
  thirdLevelOrganization: string | null;
  positionName: string | null;
  sourceProfile: PersonnelSourceProfile;
  active: boolean;
  updatedAt: Date;
  user: { id: string } | null;
};

type Resolution = {
  districtId: string | null;
  ruleId: string | null;
  status: "MAPPED" | "UNMAPPED" | "AMBIGUOUS";
  reason: string | null;
};

@Injectable()
export class PersonnelBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly policy: AdministrationPolicyService,
  ) {}

  async listRules(identity: AuthIdentity): Promise<PersonnelDistrictRuleView[]> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const rows = await this.prisma.personnelDistrictRule.findMany({
      include: { district: true },
      orderBy: [{ enabled: "desc" }, { priority: "desc" }, { name: "asc" }],
    });
    return rows.map((row) => this.ruleView(row));
  }

  async createRule(
    identity: AuthIdentity,
    dto: PersonnelDistrictRuleDto,
  ): Promise<PersonnelDistrictRuleView> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const district = await this.prisma.district.findUnique({
      where: { id: dto.districtId },
    });
    if (!district || !district.enabled) throw notFound("有效区县不存在");
    const includeText = dto.includeText.normalize("NFKC").trim();
    const excludeText = dto.excludeText?.normalize("NFKC").trim() || null;
    if (!includeText) throw new BadRequestException("关键词不能为空");
    const duplicate = await this.prisma.personnelDistrictRule.findFirst({
      where: { includeText, excludeText, districtId: dto.districtId },
    });
    if (duplicate)
      throw new ConflictException({
        message: "相同组织匹配规则已存在",
        errorCode: "PERSONNEL_DISTRICT_RULE_EXISTS",
      });
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.personnelDistrictRule.create({
        data: {
          name: dto.name.trim(),
          includeText,
          excludeText,
          priority: dto.priority,
          enabled: dto.enabled,
          districtId: dto.districtId,
        },
        include: { district: true },
      });
      await this.audit(tx, identity.id, "PERSONNEL_DISTRICT_RULE_CREATED", {
        ruleId: created.id,
        districtId: created.districtId,
      });
      return created;
    });
    return this.ruleView(row);
  }

  async updateRule(
    identity: AuthIdentity,
    ruleId: string,
    dto: PersonnelDistrictRuleDto,
  ): Promise<PersonnelDistrictRuleView> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const district = await this.prisma.district.findUnique({
      where: { id: dto.districtId },
    });
    if (!district || !district.enabled) throw notFound("有效区县不存在");
    const current = await this.prisma.personnelDistrictRule.findUnique({
      where: { id: ruleId },
    });
    if (!current) throw notFound("组织区县规则不存在");
    const includeText = dto.includeText.normalize("NFKC").trim();
    const excludeText = dto.excludeText?.normalize("NFKC").trim() || null;
    const duplicate = await this.prisma.personnelDistrictRule.findFirst({
      where: {
        id: { not: ruleId },
        includeText,
        excludeText,
        districtId: dto.districtId,
      },
    });
    if (duplicate)
      throw new ConflictException({
        message: "相同组织匹配规则已存在",
        errorCode: "PERSONNEL_DISTRICT_RULE_EXISTS",
      });
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.personnelDistrictRule.update({
        where: { id: ruleId },
        data: {
          name: dto.name.trim(),
          includeText,
          excludeText,
          priority: dto.priority,
          enabled: dto.enabled,
          districtId: dto.districtId,
        },
        include: { district: true },
      });
      await this.audit(tx, identity.id, "PERSONNEL_DISTRICT_RULE_UPDATED", {
        ruleId,
        districtId: updated.districtId,
      });
      return updated;
    });
    return this.ruleView(row);
  }

  async preview(
    identity: AuthIdentity,
    dto: PersonnelAccountBatchPreviewDto,
  ): Promise<PersonnelAccountBatchView> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const search = dto.search?.normalize("NFKC").trim() || null;
    const [rules, districts] = await Promise.all([
      this.loadRules(),
      this.prisma.district.findMany({ where: { enabled: true } }),
    ]);
    const where = this.personnelWhere(search);
    const personnel = (await this.prisma.personnel.findMany({
      where,
      include: { user: { select: { id: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
    })) as PersonForBatch[];
    const existingPhoneIndexes = await this.existingPhoneIndexes(personnel);
    const districtByCode = new Map(districts.map((row) => [row.code, row]));
    const items = personnel.map((person) =>
      this.classify(person, rules, districtByCode, existingPhoneIndexes),
    );
    const counters = this.countItems(items);
    const fingerprint = this.mappingFingerprint(rules);
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.personnelAccountBatch.create({
        data: {
          search,
          status: PersonnelAccountBatchStatus.PREVIEWED,
          mappingFingerprint: fingerprint,
          totalRows: items.length,
          eligibleRows: counters.eligible,
          skippedExistingRows: counters.skippedExisting,
          skippedInactiveRows: counters.skippedInactive,
          skippedNoPhoneRows: counters.skippedNoPhone,
          skippedUnmappedRows: counters.skippedUnmapped,
          skippedAmbiguousRows: counters.skippedAmbiguous,
          actorUserId: identity.id,
          expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
        },
      });
      for (const chunk of this.chunks(items, 500)) {
        await tx.personnelAccountBatchItem.createMany({
          data: chunk.map((item) => ({
            batchId: created.id,
            personnelId: item.personnel.id,
            districtId: item.districtId,
            ruleId: item.ruleId,
            status: item.status,
            reason: item.reason,
          })),
        });
      }
      await this.audit(tx, identity.id, "PERSONNEL_ACCOUNT_BATCH_PREVIEWED", {
        batchId: created.id,
        totalRows: items.length,
        eligibleRows: counters.eligible,
      });
      return created;
    });
    return this.batchView(batch.id);
  }

  async execute(
    identity: AuthIdentity,
    batchId: string,
  ): Promise<PersonnelAccountBatchView> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const batch = await this.prisma.personnelAccountBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw notFound("批量开户批次不存在");
    if (
      batch.status === PersonnelAccountBatchStatus.QUEUED ||
      batch.status === PersonnelAccountBatchStatus.RUNNING ||
      batch.status === PersonnelAccountBatchStatus.COMPLETED ||
      batch.status === PersonnelAccountBatchStatus.PARTIAL
    )
      return this.batchView(batchId);
    if (batch.expiresAt <= new Date()) {
      await this.prisma.personnelAccountBatch.update({
        where: { id: batchId },
        data: { status: PersonnelAccountBatchStatus.EXPIRED },
      });
      throw new ConflictException({
        message: "预检已过期，请重新预检",
        errorCode: "PERSONNEL_BATCH_PREVIEW_EXPIRED",
      });
    }
    const fingerprint = this.mappingFingerprint(await this.loadRules());
    if (fingerprint !== batch.mappingFingerprint)
      throw new ConflictException({
        message: "组织区县规则已变化，请重新预检",
        errorCode: "PERSONNEL_BATCH_PREVIEW_STALE",
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.personnelAccountBatch.update({
        where: { id: batchId },
        data: { status: PersonnelAccountBatchStatus.QUEUED },
      });
      await tx.outboxEvent.create({
        data: {
          type: "PERSONNEL_ACCOUNT_BATCH_REQUESTED",
          aggregateId: batchId,
          payload: { batchId },
        },
      });
      await this.audit(tx, identity.id, "PERSONNEL_ACCOUNT_BATCH_QUEUED", {
        batchId,
      });
    });
    return this.batchView(batchId);
  }

  async listBatches(identity: AuthIdentity): Promise<PersonnelAccountBatchView[]> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const rows = await this.prisma.personnelAccountBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return Promise.all(rows.map((row) => this.batchView(row.id)));
  }

  async getBatch(
    identity: AuthIdentity,
    batchId: string,
  ): Promise<PersonnelAccountBatchView> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    return this.batchView(batchId);
  }

  async listItems(
    identity: AuthIdentity,
    batchId: string,
    query: PersonnelAccountBatchItemQueryDto,
  ): Promise<PageResult<PersonnelAccountBatchItemView>> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    const status = query.status as PersonnelAccountBatchItemStatus | undefined;
    const where: Prisma.PersonnelAccountBatchItemWhereInput = {
      batchId,
      ...(status && Object.values(PersonnelAccountBatchItemStatus).includes(status)
        ? { status }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.personnelAccountBatchItem.findMany({
        where,
        include: { personnel: true, district: true },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.personnelAccountBatchItem.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        personnelId: row.personnelId,
        personnelCode: row.personnel.personnelCode,
        name: row.personnel.name,
        sourceProfile: row.personnel.sourceProfile,
        organizationPath: row.personnel.organizationPath,
        positionName: row.personnel.positionName,
        districtName: row.district?.name ?? null,
        status: row.status,
        reason: row.reason,
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async exportBatch(
    identity: AuthIdentity,
    batchId: string,
    token: string | undefined,
    response: Response,
  ): Promise<void> {
    this.policy.assertCanBatchProvisionPersonnel(identity);
    await this.consumeReauth(identity.id, token);
    const batch = await this.prisma.personnelAccountBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw notFound("批量开户批次不存在");
    const count = await this.prisma.personnelAccountBatchItem.count({
      where: { batchId },
    });
    if (count > MAX_EXPORT_ROWS)
      throw new BadRequestException({
        message: "批量明细超过50000行，暂不支持导出",
        errorCode: "EXPORT_TOO_LARGE",
      });
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="personnel-account-batch-${batchId}.xlsx"`,
    );
    await this.audit(this.prisma, identity.id, "PERSONNEL_ACCOUNT_BATCH_EXPORTED", {
      batchId,
      rowCount: count,
    });
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: response,
      useStyles: true,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet("开户结果");
    sheet.columns = [
      { header: "人员编码", key: "personnelCode", width: 22 },
      { header: "姓名", key: "name", width: 16 },
      { header: "来源", key: "source", width: 16 },
      { header: "组织", key: "organization", width: 42 },
      { header: "职务", key: "position", width: 24 },
      { header: "手机号", key: "phone", width: 16 },
      { header: "区县", key: "district", width: 16 },
      { header: "结果", key: "status", width: 24 },
      { header: "原因", key: "reason", width: 42 },
      { header: "更新时间", key: "updatedAt", width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.personnelAccountBatchItem.findMany({
        where: { batchId, ...(cursor ? { id: { gt: cursor } } : {}) },
        include: { personnel: true, district: true },
        orderBy: { id: "asc" },
        take: 500,
      });
      if (!rows.length) break;
      for (const row of rows) {
        const phone = this.preferredPhone(row.personnel);
        sheet.addRow({
          personnelCode: row.personnel.personnelCode,
          name: row.personnel.name,
          source: row.personnel.sourceProfile === "CONTACT_ONLY" ? "联系人简表" : "完整人员表",
          organization: row.personnel.organizationPath ?? "—",
          position: row.personnel.positionName ?? "—",
          phone: phone ? this.maskPhone(phone) : "—",
          district: row.district?.name ?? "—",
          status: row.status,
          reason: row.reason ?? "—",
          updatedAt: row.updatedAt.toLocaleString("zh-CN"),
        }).commit();
      }
      const last = rows[rows.length - 1];
      if (!last) break;
      cursor = last.id;
    }
    await workbook.commit();
  }

  async processBatch(batchId: string): Promise<void> {
    const batch = await this.prisma.personnelAccountBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.status === PersonnelAccountBatchStatus.COMPLETED) return;
    await this.prisma.personnelAccountBatch.updateMany({
      where: { id: batchId, status: PersonnelAccountBatchStatus.QUEUED },
      data: { status: PersonnelAccountBatchStatus.RUNNING, startedAt: new Date() },
    });
    const items = await this.prisma.personnelAccountBatchItem.findMany({
      where: { batchId, status: PersonnelAccountBatchItemStatus.ELIGIBLE },
      include: { personnel: true },
      orderBy: { id: "asc" },
    });
    try {
      for (const item of items) await this.processItem(batch.actorUserId, item.id);
    } catch (error) {
      await this.prisma.personnelAccountBatch.update({
        where: { id: batchId },
        data: {
          status: PersonnelAccountBatchStatus.FAILED,
          completedAt: new Date(),
        },
      });
      throw error;
    }
    const statuses = await this.prisma.personnelAccountBatchItem.findMany({
      where: { batchId },
      select: { status: true },
    });
    const failed = statuses.filter(
      (row) => row.status === PersonnelAccountBatchItemStatus.FAILED,
    ).length;
    const created = statuses.filter(
      (row) => row.status === PersonnelAccountBatchItemStatus.CREATED,
    ).length;
    const counts = this.countStatuses(statuses.map((row) => row.status));
    await this.prisma.personnelAccountBatch.update({
      where: { id: batchId },
      data: {
        status: failed ? PersonnelAccountBatchStatus.PARTIAL : PersonnelAccountBatchStatus.COMPLETED,
        createdRows: created,
        skippedExistingRows: counts.skippedExisting,
        skippedInactiveRows: counts.skippedInactive,
        skippedNoPhoneRows: counts.skippedNoPhone,
        skippedUnmappedRows: counts.skippedUnmapped,
        skippedAmbiguousRows: counts.skippedAmbiguous,
        failedRows: failed,
        completedAt: new Date(),
      },
    });
  }

  private async processItem(actorUserId: string, itemId: string): Promise<void> {
    const item = await this.prisma.personnelAccountBatchItem.findUnique({
      where: { id: itemId },
      include: { personnel: true, batch: true },
    });
    if (!item || item.status !== PersonnelAccountBatchItemStatus.ELIGIBLE) return;
    const personnel = item.personnel;
    if (!personnel.active) {
      await this.updateItem(itemId, PersonnelAccountBatchItemStatus.SKIPPED_INACTIVE, "人员已停用");
      return;
    }
    const phone = this.preferredPhone(personnel);
    if (!phone) {
      await this.updateItem(itemId, PersonnelAccountBatchItemStatus.SKIPPED_NO_PHONE, "没有有效个人或工作手机号");
      return;
    }
    const phoneBlindIndex = this.crypto.blindIndex(phone);
    const passwordHash = await argon2.hash(initialPasswordFromPhone(phone), {
      type: argon2.argon2id,
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.personnelAccountBatchItem.findUnique({
          where: { id: itemId },
          include: { personnel: { include: { user: { select: { id: true } } } } },
        });
        if (!current || current.status !== PersonnelAccountBatchItemStatus.ELIGIBLE) return;
        if (!current.personnel.active) {
          await tx.personnelAccountBatchItem.update({
            where: { id: itemId },
            data: { status: PersonnelAccountBatchItemStatus.SKIPPED_INACTIVE, reason: "人员已停用" },
          });
          return;
        }
        if (current.personnel.user) {
          await tx.personnelAccountBatchItem.update({
            where: { id: itemId },
            data: {
              status: PersonnelAccountBatchItemStatus.SKIPPED_EXISTING,
              reason: "人员已关联系统账号",
            },
          });
          return;
        }
        const existing = await tx.user.findUnique({ where: { phoneBlindIndex } });
        if (existing) {
          await tx.personnelAccountBatchItem.update({
            where: { id: itemId },
            data: { status: PersonnelAccountBatchItemStatus.SKIPPED_EXISTING, reason: "手机号已存在系统账号" },
          });
          return;
        }
        const district = current.districtId
          ? await tx.district.findUnique({ where: { id: current.districtId } })
          : null;
        if (!district?.enabled) {
          await tx.personnelAccountBatchItem.update({
            where: { id: itemId },
            data: { status: PersonnelAccountBatchItemStatus.SKIPPED_UNMAPPED, reason: "目标区县已停用或不存在" },
          });
          return;
        }
        const encrypted = this.crypto.encrypt(phone);
        const user = await tx.user.create({
          data: {
            phoneCiphertext: encrypted.ciphertext,
            phoneIv: encrypted.iv,
            phoneTag: encrypted.tag,
            phoneBlindIndex,
            displayName: current.personnel.name,
            personnelId: current.personnel.id,
            credential: { create: { passwordHash } },
            grants: {
              create: { role: RoleCode.FIELD_REPORTER, districtId: district.id },
            },
          },
        });
        await tx.personnelAccountBatchItem.update({
          where: { id: itemId },
          data: { status: PersonnelAccountBatchItemStatus.CREATED, reason: null },
        });
        await this.audit(tx, actorUserId, "PERSONNEL_ACCOUNT_BATCH_ACCOUNT_CREATED", {
          batchId: current.batchId,
          itemId,
          personnelId: current.personnelId,
          targetUserId: user.id,
          districtId: district.id,
          role: RoleCode.FIELD_REPORTER,
        });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "开户失败";
      await this.updateItem(itemId, PersonnelAccountBatchItemStatus.FAILED, reason);
    }
  }

  private async updateItem(
    itemId: string,
    status: PersonnelAccountBatchItemStatus,
    reason: string,
  ): Promise<void> {
    await this.prisma.personnelAccountBatchItem.update({
      where: { id: itemId },
      data: { status, reason },
    });
  }

  private async batchView(batchId: string): Promise<PersonnelAccountBatchView> {
    const batch = await this.prisma.personnelAccountBatch.findUnique({
      where: { id: batchId },
      include: { items: { include: { district: true } } },
    });
    if (!batch) throw notFound("批量开户批次不存在");
    const statuses = batch.items.map((item) => item.status);
    const counts = this.countStatuses(statuses);
    const districtMap = new Map<string, { districtId: string; districtName: string; count: number }>();
    for (const item of batch.items) {
      if (!item.district) continue;
      const current = districtMap.get(item.district.id);
      if (current) current.count += 1;
      else districtMap.set(item.district.id, { districtId: item.district.id, districtName: item.district.name, count: 1 });
    }
    return {
      id: batch.id,
      search: batch.search,
      status: batch.status,
      totalRows: batch.totalRows,
      eligibleRows: batch.eligibleRows,
      createdRows: counts.created,
      skippedExistingRows: counts.skippedExisting,
      skippedInactiveRows: counts.skippedInactive,
      skippedNoPhoneRows: counts.skippedNoPhone,
      skippedUnmappedRows: counts.skippedUnmapped,
      skippedAmbiguousRows: counts.skippedAmbiguous,
      failedRows: counts.failed,
      progressRows: statuses.filter((status) => status !== PersonnelAccountBatchItemStatus.ELIGIBLE).length,
      districtCounts: [...districtMap.values()].sort((a, b) => b.count - a.count),
      createdAt: batch.createdAt.toISOString(),
      startedAt: batch.startedAt?.toISOString() ?? null,
      completedAt: batch.completedAt?.toISOString() ?? null,
      expiresAt: batch.expiresAt.toISOString(),
    };
  }

  private classify(
    personnel: PersonForBatch,
    rules: Rule[],
    districtByCode: Map<string, { id: string; code: string; name: string; enabled: boolean }>,
    existingPhoneIndexes: Set<string>,
  ): {
    personnel: PersonForBatch;
    status: PersonnelAccountBatchItemStatus;
    districtId: string | null;
    ruleId: string | null;
    reason: string | null;
  } {
    if (personnel.user)
      return {
        personnel,
        status: PersonnelAccountBatchItemStatus.SKIPPED_EXISTING,
        districtId: null,
        ruleId: null,
        reason: "人员已关联系统账号",
      };
    if (!personnel.active)
      return {
        personnel,
        status: PersonnelAccountBatchItemStatus.SKIPPED_INACTIVE,
        districtId: null,
        ruleId: null,
        reason: "人员已停用",
      };
    const phone = this.preferredPhone(personnel);
    if (!phone)
      return {
        personnel,
        status: PersonnelAccountBatchItemStatus.SKIPPED_NO_PHONE,
        districtId: null,
        ruleId: null,
        reason: "没有有效个人或工作手机号",
      };
    if (existingPhoneIndexes.has(this.crypto.blindIndex(phone)))
      return {
        personnel,
        status: PersonnelAccountBatchItemStatus.SKIPPED_EXISTING,
        districtId: null,
        ruleId: null,
        reason: "手机号已存在系统账号",
      };
    const resolution = this.resolve(personnel, rules, districtByCode);
    if (resolution.status === "UNMAPPED")
      return {
        personnel,
        status: PersonnelAccountBatchItemStatus.SKIPPED_UNMAPPED,
        districtId: null,
        ruleId: null,
        reason: resolution.reason,
      };
    if (resolution.status === "AMBIGUOUS")
      return {
        personnel,
        status: PersonnelAccountBatchItemStatus.SKIPPED_AMBIGUOUS,
        districtId: null,
        ruleId: null,
        reason: resolution.reason,
      };
    return {
      personnel,
      status: PersonnelAccountBatchItemStatus.ELIGIBLE,
      districtId: resolution.districtId,
      ruleId: resolution.ruleId,
      reason: null,
    };
  }

  private resolve(
    personnel: PersonForBatch,
    rules: Rule[],
    districtByCode: Map<string, { id: string; code: string; name: string; enabled: boolean }>,
  ): Resolution {
    const jinNiu = districtByCode.get("510106");
    if (personnel.sourceProfile === PersonnelSourceProfile.CONTACT_ONLY)
      return jinNiu
        ? { districtId: jinNiu.id, ruleId: null, status: "MAPPED", reason: null }
        : { districtId: null, ruleId: null, status: "UNMAPPED", reason: "金牛区县不存在" };
    const text = [
      personnel.organizationPath,
      personnel.thirdLevelOrganization,
      personnel.secondLevelOrganization,
      personnel.firstLevelOrganization,
    ]
      .filter(Boolean)
      .join("/")
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("zh-CN");
    const matched = rules
      .filter((rule) => rule.enabled)
      .filter((rule) => text.includes(rule.includeText.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")))
      .filter((rule) => !rule.excludeText || !text.includes(rule.excludeText.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")))
      .sort((a, b) => b.priority - a.priority || b.includeText.length - a.includeText.length || a.id.localeCompare(b.id));
    if (!matched.length)
      return { districtId: null, ruleId: null, status: "UNMAPPED", reason: "组织未匹配到区县规则" };
    const first = matched[0]!;
    const conflict = matched.some(
      (rule) =>
        rule !== first &&
        rule.priority === first.priority &&
        rule.includeText.length === first.includeText.length &&
        rule.districtId !== first.districtId,
    );
    if (conflict)
      return { districtId: null, ruleId: null, status: "AMBIGUOUS", reason: "组织同时命中多个同优先级区县规则" };
    if (!first.district.enabled)
      return { districtId: null, ruleId: first.id, status: "UNMAPPED", reason: "匹配到的区县已停用" };
    return { districtId: first.districtId, ruleId: first.id, status: "MAPPED", reason: null };
  }

  private async loadRules(): Promise<Rule[]> {
    return (await this.prisma.personnelDistrictRule.findMany({
      include: { district: { select: { id: true, name: true, enabled: true } } },
      orderBy: [{ priority: "desc" }, { includeText: "asc" }, { id: "asc" }],
    })) as Rule[];
  }

  private async existingPhoneIndexes(personnel: PersonForBatch[]): Promise<Set<string>> {
    const indexes = [
      ...new Set(
        personnel.flatMap((person) =>
          [person.personalPhoneBlindIndex, person.workPhoneBlindIndex].filter(Boolean),
        ),
      ),
    ] as string[];
    const result = new Set<string>();
    for (const chunk of this.chunks(indexes, 500)) {
      const users = await this.prisma.user.findMany({
        where: { phoneBlindIndex: { in: chunk } },
        select: { phoneBlindIndex: true },
      });
      for (const user of users) result.add(user.phoneBlindIndex);
    }
    return result;
  }

  private personnelWhere(search: string | null): Prisma.PersonnelWhereInput {
    if (!search) return {};
    const options: Prisma.PersonnelWhereInput[] = [
      { personnelCode: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { organizationPath: { contains: search, mode: "insensitive" } },
      { positionName: { contains: search, mode: "insensitive" } },
      { standardPosition: { contains: search, mode: "insensitive" } },
    ];
    if (MOBILE_RE.test(search)) {
      const index = this.crypto.blindIndex(search);
      options.push({ personalPhoneBlindIndex: index }, { workPhoneBlindIndex: index });
    }
    return { OR: options };
  }

  private preferredPhone(personnel: {
    personalPhoneCiphertext: string | null;
    personalPhoneIv: string | null;
    personalPhoneTag: string | null;
    workPhoneCiphertext: string | null;
    workPhoneIv: string | null;
    workPhoneTag: string | null;
  }): string | null {
    const personal = this.decryptPhone(
      personnel.personalPhoneCiphertext,
      personnel.personalPhoneIv,
      personnel.personalPhoneTag,
    );
    if (personal && MOBILE_RE.test(personal)) return personal;
    const work = this.decryptPhone(
      personnel.workPhoneCiphertext,
      personnel.workPhoneIv,
      personnel.workPhoneTag,
    );
    return work && MOBILE_RE.test(work) ? work : null;
  }

  private decryptPhone(
    ciphertext: string | null,
    iv: string | null,
    tag: string | null,
  ): string | null {
    if (!ciphertext || !iv || !tag) return null;
    try {
      return this.crypto.decrypt({ ciphertext, iv, tag }).trim();
    } catch {
      return null;
    }
  }

  private ruleView(row: {
    id: string;
    name: string;
    includeText: string;
    excludeText: string | null;
    priority: number;
    enabled: boolean;
    districtId: string;
    district: { name: string };
    updatedAt: Date;
  }): PersonnelDistrictRuleView {
    return {
      id: row.id,
      name: row.name,
      includeText: row.includeText,
      excludeText: row.excludeText,
      priority: row.priority,
      enabled: row.enabled,
      districtId: row.districtId,
      districtName: row.district.name,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mappingFingerprint(rules: Rule[]): string {
    return createHash("sha256")
      .update(
        JSON.stringify(
          rules.map((rule) => ({
            id: rule.id,
            includeText: rule.includeText,
            excludeText: rule.excludeText,
            priority: rule.priority,
            enabled: rule.enabled,
            districtId: rule.districtId,
            updatedAt: rule.updatedAt.toISOString(),
          })),
        ),
      )
      .digest("hex");
  }

  private countItems(items: Array<{ status: PersonnelAccountBatchItemStatus }>) {
    return this.countStatuses(items.map((item) => item.status));
  }

  private countStatuses(statuses: PersonnelAccountBatchItemStatus[]) {
    return {
      eligible: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.ELIGIBLE).length,
      created: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.CREATED).length,
      skippedExisting: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.SKIPPED_EXISTING).length,
      skippedInactive: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.SKIPPED_INACTIVE).length,
      skippedNoPhone: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.SKIPPED_NO_PHONE).length,
      skippedUnmapped: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.SKIPPED_UNMAPPED).length,
      skippedAmbiguous: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.SKIPPED_AMBIGUOUS).length,
      failed: statuses.filter((status) => status === PersonnelAccountBatchItemStatus.FAILED).length,
    };
  }

  private chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size)
      result.push(values.slice(index, index + size));
    return result;
  }

  private maskPhone(phone: string): string {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  private async consumeReauth(userId: string, token?: string): Promise<void> {
    if (!token)
      throw new UnauthorizedException({
        message: "导出前必须重新验证密码",
        errorCode: "REAUTH_REQUIRED",
      });
    const result = await this.prisma.reauthToken.updateMany({
      where: {
        userId,
        tokenHash: this.crypto.hashOpaqueToken(token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (result.count !== 1)
      throw new UnauthorizedException({
        message: "导出授权无效、已使用或已过期",
        errorCode: "REAUTH_INVALID",
      });
  }

  private async audit(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.accessAudit.create({
      data: {
        userId,
        action,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
