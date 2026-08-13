import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import type {
  PageResult,
  PersonnelImportView,
  PersonnelPositionView,
  PersonnelView,
  RoleCode as ContractRoleCode,
} from "@oms/contracts";
import argon2 from "argon2";
import { Workbook } from "exceljs";
import { createHash, randomUUID } from "node:crypto";
import type { AuthIdentity } from "../../common/auth.types";
import {
  CryptoService,
  type EncryptedValue,
} from "../../common/crypto.service";
import { notFound } from "../../common/http-error";
import { initialPasswordFromPhone } from "../../common/initial-password";
import { PrismaService } from "../../common/prisma.service";
import {
  PersonnelImportMode,
  PersonnelSourceProfile,
  Prisma,
  RoleCode,
  type Personnel,
} from "../../generated/prisma/client";
import { AdministrationPolicyService } from "./admin-policy.service";
import {
  CreatePersonnelAccountDto,
  PersonnelImportDto,
  PersonnelImportModeDto,
  PersonnelListQueryDto,
  PersonnelPositionDto,
  UpdatePersonnelPositionDto,
} from "./personnel.dto";

const FULL_REQUIRED_HEADERS = ["人员编码", "人员姓名"] as const;
const CONTACT_REQUIRED_HEADERS = ["姓名", "联系电话"] as const;
const SENSITIVE_HEADERS = [
  "身份证号码",
  "性别",
  "出生日期",
  "年龄",
  "出生地点",
  "籍贯",
  "婚姻状态",
  "民族",
  "核心/非核心",
  "是否为骨干人员",
  "参加工作日期",
  "工龄",
  "首次服务时间",
  "最新进入时间",
  "政治面貌",
  "加入日期",
  "户口类别",
  "户口所在地",
  "个人邮箱",
  "通讯地址",
  "紧急联系人",
  "紧急联系人电话",
  "最高学历",
  "学位",
  "毕业院校",
  "专业名称",
  "入学日期",
  "毕业日期",
  "是否全日制",
  "资质证书名称",
  "银行卡账号",
  "开户行",
  "开户支行",
  "结算单位",
  "移动工号",
  "实习期开始时间",
  "实习期结束时间",
  "试用期开始时间",
  "试用期结束时间",
  "是否推送集团系统",
  "学历证书附件",
  "合同附件",
  "证书附件",
  "身份证附件",
  "银行卡附件",
  "体检报告附件",
  "无犯罪记录证明",
  "保密类附件",
  "安全类附件",
  "其它附件",
] as const;

type ImportedPersonnel = {
  rowNumber: number;
  personnelCode: string;
  name: string;
  personalPhone: string | null;
  workPhone: string | null;
  organizationPath: string | null;
  firstLevelOrganization: string | null;
  secondLevelOrganization: string | null;
  thirdLevelOrganization: string | null;
  positionName: string | null;
  businessLine: string | null;
  positionCategory: string | null;
  standardPosition: string | null;
  positionTags: string | null;
  employmentStatus: string | null;
  personnelType: string | null;
  contractType: string | null;
  cooperativeEnterprise: string | null;
  cooperativeEmploymentType: string | null;
  cooperativeEmploymentSource: string | null;
  employmentManagement: string | null;
  compensationType: string | null;
  settlementProject: string | null;
  notes: string | null;
};

type ImportCounters = {
  createdRows: number;
  updatedRows: number;
  deactivatedRows: number;
  skippedRows: number;
  accountsCreated: number;
  accountsLinked: number;
};

type PersonnelRecord = Personnel;
type PersonnelLookup = {
  byCode: Map<string, PersonnelRecord[]>;
  byPhone: Map<string, PersonnelRecord[]>;
};
type PreparedPersonnel = {
  index: number;
  row: ImportedPersonnel;
  id: string;
  existing: PersonnelRecord | null;
  data: Prisma.PersonnelUncheckedCreateInput &
    Prisma.PersonnelUncheckedUpdateInput;
};

@Injectable()
export class PersonnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly policy: AdministrationPolicyService,
  ) {}

  async importWorkbook(
    identity: AuthIdentity,
    file: Express.Multer.File | undefined,
    dto: PersonnelImportDto,
  ): Promise<PersonnelImportView> {
    this.policy.assertCanImportPersonnel(identity);
    if (!file?.buffer?.length)
      throw new BadRequestException({
        message: "请上传人员基础信息 XLSX 文件",
        errorCode: "PERSONNEL_FILE_REQUIRED",
      });
    if (
      dto.createAccounts &&
      (dto.provisionSystemAdminCount > 0 || dto.provisionSystemAdminPhone)
    )
      throw new BadRequestException({
        message: "普通批量建号和管理岗位开通不能在同一次同步中同时启用",
        errorCode: "PERSONNEL_PROVISIONING_MODE_CONFLICT",
      });

    const parsed = await this.parseWorkbook(file.buffer);
    if (!parsed.rows.length)
      throw new BadRequestException({
        message: "文件中没有可同步的人员数据",
        errorCode: "PERSONNEL_ROWS_EMPTY",
      });
    this.assertProvisioningRequest(parsed, dto);

    const sourceFileName = file.originalname
      .replace(/[\\/]/g, "_")
      .slice(0, 240);
    const mode =
      dto.mode === PersonnelImportModeDto.SNAPSHOT
        ? PersonnelImportMode.SNAPSHOT
        : PersonnelImportMode.UPSERT;
    const previewCounters = await this.previewCounters(
      parsed.rows,
      parsed.sourceProfile,
      dto,
    );
    previewCounters.skippedRows = parsed.skippedRows;
    if (dto.dryRun) {
      const now = new Date().toISOString();
      return {
        id: "preview",
        fileName: sourceFileName,
        mode,
        status: "PREVIEW",
        sourceProfile: parsed.sourceProfile,
        totalRows: parsed.rows.length,
        ...previewCounters,
        warnings: parsed.warnings,
        createdAt: now,
        completedAt: now,
      };
    }

    const ordinaryPasswordHashes = new Map<string, string>();
    const counters: ImportCounters = {
      createdRows: 0,
      updatedRows: 0,
      deactivatedRows: 0,
      skippedRows: parsed.skippedRows,
      accountsCreated: 0,
      accountsLinked: 0,
    };
    const warnings = [...parsed.warnings];
    const syncedPersonnelIds: string[] = [];
    let importId: string | null = null;

    await this.prisma.$transaction(
      async (tx) => {
        const lookup = await this.loadPersonnelLookup(tx, parsed.rows);
        const prepared: PreparedPersonnel[] = parsed.rows.map((row, index) => {
          const existing = this.matchExistingPersonnel(lookup, row);
          const personalPhone = this.encryptPhone(row.personalPhone);
          const workPhone = this.encryptPhone(row.workPhone);
          const data = this.completePersonnelData(
            row,
            parsed.sourceProfile,
            sourceFileName,
            personalPhone,
            workPhone,
            existing,
          );
          return {
            index,
            row,
            id: existing?.id ?? randomUUID(),
            existing,
            data,
          };
        });
        await this.bulkUpsertPersonnel(tx, prepared);
        await this.ensurePositions(tx, parsed.rows, parsed.sourceProfile);
        const existingUserPhones = await this.loadExistingUserPhoneIndexes(
          tx,
          parsed.rows,
        );

        for (const item of prepared) {
          const { index, row, id, existing } = item;
          syncedPersonnelIds.push(id);
          if (existing) counters.updatedRows += 1;
          else counters.createdRows += 1;

          const accountPhone = row.personalPhone ?? row.workPhone;
          if (accountPhone) {
            const managementRoles = this.managementRolesForRow(index, row, dto);
            if (managementRoles.length) {
              await this.ensureManagementAccount(
                tx,
                id,
                row,
                accountPhone,
                managementRoles,
                counters,
                identity,
              );
            } else if (
              dto.createAccounts ||
              existingUserPhones.has(this.crypto.blindIndex(accountPhone))
            ) {
              const ordinaryPasswordHash =
                dto.createAccounts &&
                !existingUserPhones.has(this.crypto.blindIndex(accountPhone))
                  ? await this.passwordHashForPhone(
                      accountPhone,
                      ordinaryPasswordHashes,
                    )
                  : null;
              await this.linkOrCreateOrdinaryAccount(
                tx,
                id,
                row,
                accountPhone,
                ordinaryPasswordHash,
                counters,
                warnings,
              );
            }
          }
        }

        if (mode === PersonnelImportMode.SNAPSHOT) {
          const result = await tx.personnel.updateMany({
            where: {
              active: true,
              sourceProfile: parsed.sourceProfile,
              id: { notIn: syncedPersonnelIds },
            },
            data: { active: false },
          });
          counters.deactivatedRows = result.count;
        }

        const record = await tx.personnelImport.create({
          data: {
            fileName: sourceFileName,
            mode,
            status: "APPLIED",
            sourceProfile: parsed.sourceProfile,
            totalRows: parsed.rows.length,
            ...counters,
            warnings: warnings.slice(0, 200),
            actorUserId: identity.id,
            completedAt: new Date(),
          },
        });
        importId = record.id;
        await this.policy.audit(
          identity,
          "PERSONNEL_IMPORT_APPLIED",
          {
            importId: record.id,
            sourceProfile: parsed.sourceProfile,
            totalRows: parsed.rows.length,
            createdRows: counters.createdRows,
            updatedRows: counters.updatedRows,
            accountsCreated: counters.accountsCreated,
          },
          tx,
        );
      },
      { maxWait: 5_000, timeout: 10 * 60_000 },
    );

    if (!importId) throw new Error("人员同步记录创建失败");
    const record = await this.prisma.personnelImport.findUniqueOrThrow({
      where: { id: importId },
    });
    return this.importView(record);
  }

  async list(
    identity: AuthIdentity,
    query: PersonnelListQueryDto,
  ): Promise<PageResult<PersonnelView>> {
    this.policy.assertCanManagePersonnel(identity);
    const search = query.search?.normalize("NFKC").trim();
    const searchOptions: Prisma.PersonnelWhereInput[] = [];
    if (search) {
      searchOptions.push(
        { personnelCode: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { organizationPath: { contains: search, mode: "insensitive" } },
        { positionName: { contains: search, mode: "insensitive" } },
        { standardPosition: { contains: search, mode: "insensitive" } },
      );
      if (/^1[3-9]\d{9}$/.test(search)) {
        const index = this.crypto.blindIndex(search);
        searchOptions.push(
          { personalPhoneBlindIndex: index },
          { workPhoneBlindIndex: index },
        );
      }
    }
    const where: Prisma.PersonnelWhereInput = {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(searchOptions.length ? { OR: searchOptions } : {}),
    };
    const [items, total, positions] = await this.prisma.$transaction([
      this.prisma.personnel.findMany({
        where,
        include: { user: { select: { id: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.personnel.count({ where }),
      this.prisma.personnelPosition.findMany({
        where: { enabled: true },
        include: { roleTemplates: true },
      }),
    ]);
    const roleTemplates = new Map(
      positions.map((position) => [
        position.name,
        position.roleTemplates.map((template) => template.role),
      ]),
    );
    return {
      items: items.map((item) => this.personnelView(item, roleTemplates)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listImports(identity: AuthIdentity): Promise<PersonnelImportView[]> {
    this.policy.assertCanManagePersonnel(identity);
    const rows = await this.prisma.personnelImport.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return rows.map((row) => this.importView(row));
  }

  async listPositions(
    identity: AuthIdentity,
  ): Promise<PersonnelPositionView[]> {
    this.policy.assertCanManagePersonnel(identity);
    const rows = await this.prisma.personnelPosition.findMany({
      include: { roleTemplates: true },
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
    });
    return rows.map((row) => this.positionView(row));
  }

  async createPosition(
    identity: AuthIdentity,
    dto: PersonnelPositionDto,
  ): Promise<PersonnelPositionView> {
    const roles = this.distinctRoles(dto.roles);
    this.policy.assertCanConfigureTemplate(identity, roles);
    const code = dto.code.trim();
    const name = dto.name.trim();
    if (
      await this.prisma.personnelPosition.findFirst({
        where: { OR: [{ code }, { name }] },
      })
    )
      throw new ConflictException({
        message: "职务编码或名称已存在",
        errorCode: "PERSONNEL_POSITION_EXISTS",
      });

    return this.prisma.$transaction(async (tx) => {
      const position = await tx.personnelPosition.create({
        data: {
          code,
          name,
          roleTemplates: {
            create: roles.map((role) => ({ role })),
          },
        },
        include: { roleTemplates: true },
      });
      await this.policy.audit(
        identity,
        "PERSONNEL_POSITION_CREATED",
        { positionId: position.id, roles },
        tx,
      );
      return this.positionView(position);
    });
  }

  async updatePosition(
    identity: AuthIdentity,
    positionId: string,
    dto: UpdatePersonnelPositionDto,
  ): Promise<PersonnelPositionView> {
    this.policy.assertCanManagePersonnel(identity);
    const current = await this.prisma.personnelPosition.findUnique({
      where: { id: positionId },
    });
    if (!current) throw notFound("职务不存在");
    const roles =
      dto.roles === undefined ? undefined : this.distinctRoles(dto.roles);
    if (roles) this.policy.assertCanConfigureTemplate(identity, roles);

    return this.prisma.$transaction(async (tx) => {
      if (roles) {
        await tx.positionRoleTemplate.deleteMany({ where: { positionId } });
        if (roles.length)
          await tx.positionRoleTemplate.createMany({
            data: roles.map((role) => ({ positionId, role })),
          });
      }
      const updated = await tx.personnelPosition.update({
        where: { id: positionId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
        },
        include: { roleTemplates: true },
      });
      await this.policy.audit(
        identity,
        "PERSONNEL_POSITION_UPDATED",
        {
          positionId,
          nameChanged: dto.name !== undefined,
          enabled: dto.enabled ?? null,
          roles: roles ?? null,
        },
        tx,
      );
      return this.positionView(updated);
    });
  }

  async createAccount(
    identity: AuthIdentity,
    personnelId: string,
    dto: CreatePersonnelAccountDto,
  ): Promise<{ userId: string; created: boolean; linked: boolean }> {
    this.policy.assertCanManagePersonnel(identity);
    this.policy.assertCanCreateUser(identity, dto.grants);
    await this.assertEnabledDistricts(dto.grants);
    const personnel = await this.prisma.personnel.findUnique({
      where: { id: personnelId },
      include: { user: { include: { grants: true } } },
    });
    if (!personnel) throw notFound("人员不存在");
    if (!personnel.active)
      throw new BadRequestException({
        message: "已停用人员不能开通或追加账号授权",
        errorCode: "PERSONNEL_INACTIVE",
      });
    if (personnel.user) this.policy.assertCanSeeUser(identity, personnel.user);
    const phone =
      this.decryptPhone(
        personnel.personalPhoneCiphertext,
        personnel.personalPhoneIv,
        personnel.personalPhoneTag,
      ) ??
      this.decryptPhone(
        personnel.workPhoneCiphertext,
        personnel.workPhoneIv,
        personnel.workPhoneTag,
      );
    if (!phone || !/^1[3-9]\d{9}$/.test(phone))
      throw new BadRequestException({
        message: "该人员没有可用的个人或工作手机号码",
        errorCode: "PERSONNEL_PHONE_REQUIRED",
      });
    const passwordHash = await argon2.hash(initialPasswordFromPhone(phone), {
      type: argon2.argon2id,
    });
    const phoneBlindIndex = this.crypto.blindIndex(phone);

    return this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { phoneBlindIndex },
        include: { credential: true, grants: true },
      });
      let created = false;
      if (user?.personnelId && user.personnelId !== personnelId)
        throw new ConflictException({
          message: "该手机号已关联其他人员",
          errorCode: "PERSONNEL_PHONE_ACCOUNT_CONFLICT",
        });
      if (!user) {
        const encrypted = this.crypto.encrypt(phone);
        user = await tx.user.create({
          data: {
            phoneCiphertext: encrypted.ciphertext,
            phoneIv: encrypted.iv,
            phoneTag: encrypted.tag,
            phoneBlindIndex,
            displayName: personnel.name,
            personnelId,
            credential: { create: { passwordHash } },
          },
          include: { credential: true, grants: true },
        });
        created = true;
      } else {
        this.policy.assertCanSeeUser(identity, user);
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            personnelId,
            active: true,
            ...(!user.credential
              ? { credential: { create: { passwordHash } } }
              : {}),
          },
          include: { credential: true, grants: true },
        });
      }
      for (const grant of this.distinctGrants(dto.grants)) {
        const existing = await tx.roleGrant.findFirst({
          where: {
            userId: user.id,
            role: grant.role,
            districtId: grant.districtId ?? null,
            active: true,
          },
        });
        if (!existing)
          await tx.roleGrant.create({
            data: {
              userId: user.id,
              role: grant.role,
              districtId: grant.districtId ?? null,
            },
          });
      }
      await this.policy.audit(
        identity,
        "PERSONNEL_ACCOUNT_PROVISIONED",
        {
          personnelId,
          targetUserId: user.id,
          created,
          roles: dto.grants.map((grant) => grant.role),
        },
        tx,
      );
      return { userId: user.id, created, linked: true };
    });
  }

  private async previewCounters(
    rows: ImportedPersonnel[],
    sourceProfile: PersonnelSourceProfile,
    dto: PersonnelImportDto,
  ): Promise<ImportCounters> {
    const counters: ImportCounters = {
      createdRows: 0,
      updatedRows: 0,
      deactivatedRows: 0,
      skippedRows: 0,
      accountsCreated: 0,
      accountsLinked: 0,
    };
    const existingIds: string[] = [];
    const lookup = await this.loadPersonnelLookup(this.prisma, rows);
    const existingUserPhones = await this.loadExistingUserPhoneIndexes(
      this.prisma,
      rows,
    );
    for (const [index, row] of rows.entries()) {
      const existing = this.matchExistingPersonnel(lookup, row);
      if (existing) {
        counters.updatedRows += 1;
        existingIds.push(existing.id);
      } else counters.createdRows += 1;
      const phone = row.personalPhone ?? row.workPhone;
      if (!phone) continue;
      const userExists = existingUserPhones.has(this.crypto.blindIndex(phone));
      const needsAccount =
        dto.createAccounts ||
        this.managementRolesForRow(index, row, dto).length > 0;
      if (userExists) counters.accountsLinked += 1;
      else if (needsAccount) counters.accountsCreated += 1;
    }
    if (dto.mode === PersonnelImportModeDto.SNAPSHOT)
      counters.deactivatedRows = await this.prisma.personnel.count({
        where: {
          active: true,
          sourceProfile,
          id: { notIn: existingIds },
        },
      });
    return counters;
  }

  private assertProvisioningRequest(
    parsed: {
      rows: ImportedPersonnel[];
      sourceProfile: PersonnelSourceProfile;
    },
    dto: PersonnelImportDto,
  ): void {
    const provisioning =
      dto.provisionSystemAdminCount > 0 ||
      Boolean(dto.provisionSystemAdminPhone);
    if (!provisioning) return;
    if (parsed.sourceProfile !== PersonnelSourceProfile.CONTACT_ONLY)
      throw new BadRequestException({
        message: "管理岗位批量开通仅适用于“姓名、联系电话”简表",
        errorCode: "MANAGEMENT_PROVISIONING_TEMPLATE_REQUIRED",
      });
    if (dto.provisionSystemAdminCount > parsed.rows.length)
      throw new BadRequestException({
        message: "系统管理员数量超过有效联系人行数",
        errorCode: "MANAGEMENT_PROVISIONING_COUNT_INVALID",
      });
    if (
      dto.provisionSystemAdminPhone &&
      !parsed.rows.some(
        (row) => row.personalPhone === dto.provisionSystemAdminPhone,
      )
    )
      throw new BadRequestException({
        message: "指定系统管理员手机号不在本次联系人表中",
        errorCode: "SYSTEM_ADMIN_CONTACT_NOT_FOUND",
      });
  }

  private managementRolesForRow(
    index: number,
    row: ImportedPersonnel,
    dto: PersonnelImportDto,
  ): RoleCode[] {
    const selectedByOrder = index < dto.provisionSystemAdminCount;
    const selectedByPhone =
      Boolean(dto.provisionSystemAdminPhone) &&
      row.personalPhone === dto.provisionSystemAdminPhone;
    return selectedByOrder || selectedByPhone ? [RoleCode.SYSTEM_ADMIN] : [];
  }

  private async ensureManagementAccount(
    tx: Prisma.TransactionClient,
    personnelId: string,
    row: ImportedPersonnel,
    phone: string,
    roles: RoleCode[],
    counters: ImportCounters,
    identity: AuthIdentity,
  ): Promise<void> {
    const phoneBlindIndex = this.crypto.blindIndex(phone);
    let user = await tx.user.findUnique({
      where: { phoneBlindIndex },
      include: { credential: true },
    });
    if (user?.personnelId && user.personnelId !== personnelId)
      throw new ConflictException({
        message: `第 ${row.rowNumber} 行手机号已关联其他人员，无法开通管理账号`,
        errorCode: "PERSONNEL_PHONE_ACCOUNT_CONFLICT",
      });
    const passwordHash =
      !user || !user.credential
        ? await argon2.hash(initialPasswordFromPhone(phone), {
            type: argon2.argon2id,
          })
        : null;
    if (!user) {
      const encrypted = this.crypto.encrypt(phone);
      user = await tx.user.create({
        data: {
          phoneCiphertext: encrypted.ciphertext,
          phoneIv: encrypted.iv,
          phoneTag: encrypted.tag,
          phoneBlindIndex,
          displayName: row.name,
          personnelId,
          credential: { create: { passwordHash: passwordHash! } },
        },
        include: { credential: true },
      });
      counters.accountsCreated += 1;
    } else {
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          personnelId,
          active: true,
          ...(!user.credential
            ? {
                mustChangePassword: true,
                credential: { create: { passwordHash: passwordHash! } },
              }
            : {}),
        },
        include: { credential: true },
      });
      counters.accountsLinked += 1;
    }
    const activeGrantIds: string[] = [];
    for (const role of [...new Set(roles)]) {
      let activeGrant = await tx.roleGrant.findFirst({
        where: { userId: user.id, role, districtId: null, active: true },
      });
      if (!activeGrant)
        activeGrant = await tx.roleGrant.create({
          data: { userId: user.id, role, districtId: null },
        });
      activeGrantIds.push(activeGrant.id);
    }
    await this.policy.audit(
      identity,
      "PERSONNEL_MANAGEMENT_ACCOUNT_PROVISIONED",
      {
        personnelId,
        targetUserId: user.id,
        targetGrantIds: activeGrantIds,
        roles,
      },
      tx,
    );
  }

  private async linkOrCreateOrdinaryAccount(
    tx: Prisma.TransactionClient,
    personnelId: string,
    row: ImportedPersonnel,
    phone: string,
    passwordHash: string | null,
    counters: ImportCounters,
    warnings: string[],
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { phoneBlindIndex: this.crypto.blindIndex(phone) },
    });
    if (user) {
      if (!user.personnelId) {
        await tx.user.update({ where: { id: user.id }, data: { personnelId } });
        counters.accountsLinked += 1;
      } else if (user.personnelId === personnelId) {
        counters.accountsLinked += 1;
      } else {
        this.warn(
          warnings,
          `第 ${row.rowNumber} 行手机号已绑定其他人员，未覆盖账号关联`,
        );
      }
      return;
    }
    if (!passwordHash) return;
    const encrypted = this.crypto.encrypt(phone);
    await tx.user.create({
      data: {
        phoneCiphertext: encrypted.ciphertext,
        phoneIv: encrypted.iv,
        phoneTag: encrypted.tag,
        phoneBlindIndex: this.crypto.blindIndex(phone),
        displayName: row.name,
        personnelId,
        credential: { create: { passwordHash } },
      },
    });
    counters.accountsCreated += 1;
  }

  private async passwordHashForPhone(
    phone: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const normalizedPhone = phone.trim();
    const password = initialPasswordFromPhone(normalizedPhone);
    const cached = cache.get(normalizedPhone);
    if (cached) return cached;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    cache.set(normalizedPhone, passwordHash);
    return passwordHash;
  }

  private async parseWorkbook(buffer: Buffer): Promise<{
    rows: ImportedPersonnel[];
    warnings: string[];
    skippedRows: number;
    sourceProfile: PersonnelSourceProfile;
  }> {
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new BadRequestException({
        message: "无法读取 XLSX 文件，请确认文件格式正确",
        errorCode: "PERSONNEL_FILE_INVALID",
      });
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet)
      throw new BadRequestException({
        message: "XLSX 文件没有可读取的工作表",
        errorCode: "PERSONNEL_SHEET_MISSING",
      });
    const headers = new Map<string, number>();
    worksheet.getRow(1).eachCell((cell, columnNumber) => {
      const header = this.cellText(cell.value);
      if (!header) return;
      if (headers.has(header))
        throw new BadRequestException({
          message: `表头“${header}”重复，请只保留一列`,
          errorCode: "PERSONNEL_HEADER_DUPLICATE",
        });
      headers.set(header, columnNumber);
    });
    const fullTemplate = FULL_REQUIRED_HEADERS.every((header) =>
      headers.has(header),
    );
    const contactTemplate = CONTACT_REQUIRED_HEADERS.every((header) =>
      headers.has(header),
    );
    if (!fullTemplate && !contactTemplate)
      throw new BadRequestException({
        message: "模板必须包含“人员编码、人员姓名”，或仅包含“姓名、联系电话”",
        errorCode: "PERSONNEL_HEADER_MISSING",
      });
    const sourceProfile = fullTemplate
      ? PersonnelSourceProfile.FULL_DIRECTORY
      : PersonnelSourceProfile.CONTACT_ONLY;
    const warnings: string[] = [];
    const ignored = SENSITIVE_HEADERS.filter((header) => headers.has(header));
    if (ignored.length) warnings.push(`已忽略敏感列：${ignored.join("、")}`);
    const rows: ImportedPersonnel[] = [];
    const seen = new Set<string>();
    const seenPhoneRows = new Map<string, number>();
    let skippedRows = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (sourceProfile === PersonnelSourceProfile.CONTACT_ONLY) {
        const name = this.cellText(this.cell(row, headers, "姓名"));
        const rawPhone = this.cellText(this.cell(row, headers, "联系电话"));
        if (!name && !rawPhone) return;
        const phone = this.phoneText(rawPhone, rowNumber, "联系电话", warnings);
        if (!name || !phone) {
          skippedRows += 1;
          this.warn(
            warnings,
            `第 ${rowNumber} 行缺少有效姓名或联系电话，已跳过`,
          );
          return;
        }
        const personnelCode = `CONTACT_${this.crypto
          .blindIndex(phone)
          .slice(0, 32)
          .toUpperCase()}`;
        if (seen.has(personnelCode)) {
          skippedRows += 1;
          this.warn(warnings, `第 ${rowNumber} 行联系电话重复，已跳过`);
          return;
        }
        seen.add(personnelCode);
        const contact = this.contactRow(rowNumber, personnelCode, name, phone);
        this.assertPersonnelLengths(contact);
        rows.push(contact);
        return;
      }

      const personnelCode = this.cellText(this.cell(row, headers, "人员编码"));
      const name = this.cellText(this.cell(row, headers, "人员姓名"));
      if (!personnelCode && !name) return;
      if (!personnelCode || !name) {
        skippedRows += 1;
        this.warn(warnings, `第 ${rowNumber} 行缺少人员编码或姓名，已跳过`);
        return;
      }
      if (seen.has(personnelCode)) {
        skippedRows += 1;
        this.warn(warnings, `第 ${rowNumber} 行人员编码重复，已跳过`);
        return;
      }
      seen.add(personnelCode);
      const imported: ImportedPersonnel = {
        rowNumber,
        personnelCode,
        name,
        personalPhone: this.phoneText(
          this.cellText(this.cell(row, headers, "个人手机号码")),
          rowNumber,
          "个人手机号码",
          warnings,
        ),
        workPhone: this.phoneText(
          this.cellText(this.cell(row, headers, "工作手机号码")),
          rowNumber,
          "工作手机号码",
          warnings,
        ),
        organizationPath: this.optionalCell(row, headers, "协管组织"),
        firstLevelOrganization: this.optionalCell(row, headers, "一级组织"),
        secondLevelOrganization: this.optionalCell(row, headers, "二级组织"),
        thirdLevelOrganization: this.optionalCell(row, headers, "三级组织"),
        positionName: this.optionalCell(row, headers, "岗位名称"),
        businessLine: this.optionalCell(row, headers, "业务条线"),
        positionCategory: this.optionalCell(row, headers, "岗位分类"),
        standardPosition: this.optionalCell(row, headers, "标准岗位"),
        positionTags: this.optionalCell(row, headers, "岗位标签"),
        employmentStatus: this.optionalCell(row, headers, "在职状态"),
        personnelType: this.optionalCell(row, headers, "人员类型"),
        contractType: this.optionalCell(row, headers, "合同类型"),
        cooperativeEnterprise: this.optionalCell(row, headers, "合作企业"),
        cooperativeEmploymentType: this.optionalCell(
          row,
          headers,
          "合作企业用工类型",
        ),
        cooperativeEmploymentSource: this.optionalCell(
          row,
          headers,
          "合作企业用工来源",
        ),
        employmentManagement: this.optionalCell(row, headers, "用工管理方式"),
        compensationType: this.optionalCell(row, headers, "报酬方式"),
        settlementProject: this.optionalCell(row, headers, "结算项目"),
        notes: this.optionalCell(row, headers, "备注"),
      };
      this.assertPersonnelLengths(imported);
      this.assertUniqueWorkbookPhones(imported, seenPhoneRows);
      rows.push(imported);
    });
    return { rows, warnings, skippedRows, sourceProfile };
  }

  private contactRow(
    rowNumber: number,
    personnelCode: string,
    name: string,
    phone: string,
  ): ImportedPersonnel {
    return {
      rowNumber,
      personnelCode,
      name,
      personalPhone: phone,
      workPhone: null,
      organizationPath: null,
      firstLevelOrganization: null,
      secondLevelOrganization: null,
      thirdLevelOrganization: null,
      positionName: null,
      businessLine: null,
      positionCategory: null,
      standardPosition: null,
      positionTags: null,
      employmentStatus: null,
      personnelType: null,
      contractType: null,
      cooperativeEnterprise: null,
      cooperativeEmploymentType: null,
      cooperativeEmploymentSource: null,
      employmentManagement: null,
      compensationType: null,
      settlementProject: null,
      notes: null,
    };
  }

  private assertUniqueWorkbookPhones(
    row: ImportedPersonnel,
    seenPhoneRows: Map<string, number>,
  ): void {
    const indexes = [
      ...new Set(
        [row.personalPhone, row.workPhone]
          .filter((value): value is string => Boolean(value))
          .map((value) => this.crypto.blindIndex(value)),
      ),
    ];
    for (const index of indexes) {
      const previousRow = seenPhoneRows.get(index);
      if (previousRow !== undefined)
        throw new BadRequestException({
          message: `第 ${row.rowNumber} 行手机号与第 ${previousRow} 行重复，请先确认人员身份`,
          errorCode: "PERSONNEL_FILE_PHONE_DUPLICATE",
        });
      seenPhoneRows.set(index, row.rowNumber);
    }
  }

  private assertPersonnelLengths(row: ImportedPersonnel): void {
    const limits: Array<[keyof ImportedPersonnel, string, number]> = [
      ["personnelCode", "人员编码", 40],
      ["name", "姓名", 80],
      ["organizationPath", "协管组织", 240],
      ["firstLevelOrganization", "一级组织", 120],
      ["secondLevelOrganization", "二级组织", 120],
      ["thirdLevelOrganization", "三级组织", 120],
      ["positionName", "岗位名称", 120],
      ["businessLine", "业务条线", 80],
      ["positionCategory", "岗位分类", 80],
      ["standardPosition", "标准岗位", 120],
      ["positionTags", "岗位标签", 500],
      ["employmentStatus", "在职状态", 80],
      ["personnelType", "人员类型", 100],
      ["contractType", "合同类型", 100],
      ["cooperativeEnterprise", "合作企业", 160],
      ["cooperativeEmploymentType", "合作企业用工类型", 100],
      ["cooperativeEmploymentSource", "合作企业用工来源", 100],
      ["employmentManagement", "用工管理方式", 100],
      ["compensationType", "报酬方式", 100],
      ["settlementProject", "结算项目", 160],
      ["notes", "备注", 500],
    ];
    for (const [key, label, maximum] of limits) {
      const value = row[key];
      if (typeof value === "string" && value.length > maximum)
        throw new BadRequestException({
          message: `第 ${row.rowNumber} 行“${label}”超过 ${maximum} 个字符`,
          errorCode: "PERSONNEL_FIELD_TOO_LONG",
        });
    }
  }

  private async loadPersonnelLookup(
    db: Prisma.TransactionClient | PrismaService,
    rows: ImportedPersonnel[],
  ): Promise<PersonnelLookup> {
    const records = new Map<string, PersonnelRecord>();
    for (const batch of this.chunks(rows, 750)) {
      const codes = [...new Set(batch.map((row) => row.personnelCode))];
      const indexes = [
        ...new Set(
          batch
            .flatMap((row) => [row.personalPhone, row.workPhone])
            .filter((value): value is string => Boolean(value))
            .map((value) => this.crypto.blindIndex(value)),
        ),
      ];
      const found = await db.personnel.findMany({
        where: {
          OR: [
            { personnelCode: { in: codes } },
            ...(indexes.length
              ? [
                  { personalPhoneBlindIndex: { in: indexes } },
                  { workPhoneBlindIndex: { in: indexes } },
                ]
              : []),
          ],
        },
      });
      for (const item of found) records.set(item.id, item);
    }
    const lookup: PersonnelLookup = {
      byCode: new Map(),
      byPhone: new Map(),
    };
    for (const item of records.values()) {
      this.addLookupValue(lookup.byCode, item.personnelCode, item);
      for (const index of [
        item.personalPhoneBlindIndex,
        item.workPhoneBlindIndex,
      ]) {
        if (index) this.addLookupValue(lookup.byPhone, index, item);
      }
    }
    return lookup;
  }

  private matchExistingPersonnel(
    lookup: PersonnelLookup,
    row: ImportedPersonnel,
  ): PersonnelRecord | null {
    const matches = new Map<string, PersonnelRecord>();
    for (const item of lookup.byCode.get(row.personnelCode) ?? [])
      matches.set(item.id, item);
    for (const phone of [row.personalPhone, row.workPhone]) {
      if (!phone) continue;
      for (const item of lookup.byPhone.get(this.crypto.blindIndex(phone)) ??
        [])
        matches.set(item.id, item);
    }
    if (matches.size > 1)
      throw new ConflictException({
        message: `第 ${row.rowNumber} 行人员编码与手机号分别匹配到不同人员，请先合并重复数据`,
        errorCode: "PERSONNEL_IDENTITY_CONFLICT",
      });
    return matches.values().next().value ?? null;
  }

  private personnelData(
    row: ImportedPersonnel,
    sourceProfile: PersonnelSourceProfile,
    sourceFileName: string,
    personalPhone: EncryptedValue | null,
    workPhone: EncryptedValue | null,
  ): Prisma.PersonnelUncheckedCreateInput &
    Prisma.PersonnelUncheckedUpdateInput {
    return {
      personnelCode: row.personnelCode,
      name: row.name,
      personalPhoneCiphertext: personalPhone?.ciphertext ?? null,
      personalPhoneIv: personalPhone?.iv ?? null,
      personalPhoneTag: personalPhone?.tag ?? null,
      personalPhoneBlindIndex: row.personalPhone
        ? this.crypto.blindIndex(row.personalPhone)
        : null,
      workPhoneCiphertext: workPhone?.ciphertext ?? null,
      workPhoneIv: workPhone?.iv ?? null,
      workPhoneTag: workPhone?.tag ?? null,
      workPhoneBlindIndex: row.workPhone
        ? this.crypto.blindIndex(row.workPhone)
        : null,
      organizationPath: row.organizationPath,
      firstLevelOrganization: row.firstLevelOrganization,
      secondLevelOrganization: row.secondLevelOrganization,
      thirdLevelOrganization: row.thirdLevelOrganization,
      positionName: row.positionName,
      businessLine: row.businessLine,
      positionCategory: row.positionCategory,
      standardPosition: row.standardPosition,
      positionTags: row.positionTags,
      employmentStatus: row.employmentStatus,
      personnelType: row.personnelType,
      contractType: row.contractType,
      cooperativeEnterprise: row.cooperativeEnterprise,
      cooperativeEmploymentType: row.cooperativeEmploymentType,
      cooperativeEmploymentSource: row.cooperativeEmploymentSource,
      employmentManagement: row.employmentManagement,
      compensationType: row.compensationType,
      settlementProject: row.settlementProject,
      notes: row.notes,
      active: true,
      sourceProfile,
      sourceFileName,
      sourceRowNumber: row.rowNumber,
      lastSyncedAt: new Date(),
    } as Prisma.PersonnelUncheckedCreateInput &
      Prisma.PersonnelUncheckedUpdateInput;
  }

  private completePersonnelData(
    row: ImportedPersonnel,
    sourceProfile: PersonnelSourceProfile,
    sourceFileName: string,
    personalPhone: EncryptedValue | null,
    workPhone: EncryptedValue | null,
    existing: PersonnelRecord | null,
  ): Prisma.PersonnelUncheckedCreateInput &
    Prisma.PersonnelUncheckedUpdateInput {
    const data = this.personnelData(
      row,
      sourceProfile,
      sourceFileName,
      personalPhone,
      workPhone,
    );
    if (
      sourceProfile !== PersonnelSourceProfile.CONTACT_ONLY ||
      existing?.sourceProfile !== PersonnelSourceProfile.FULL_DIRECTORY
    )
      return data;

    return {
      ...data,
      personnelCode: existing.personnelCode,
      workPhoneCiphertext: existing.workPhoneCiphertext,
      workPhoneIv: existing.workPhoneIv,
      workPhoneTag: existing.workPhoneTag,
      workPhoneBlindIndex: existing.workPhoneBlindIndex,
      organizationPath: existing.organizationPath,
      firstLevelOrganization: existing.firstLevelOrganization,
      secondLevelOrganization: existing.secondLevelOrganization,
      thirdLevelOrganization: existing.thirdLevelOrganization,
      positionName: existing.positionName,
      businessLine: existing.businessLine,
      positionCategory: existing.positionCategory,
      standardPosition: existing.standardPosition,
      positionTags: existing.positionTags,
      employmentStatus: existing.employmentStatus,
      personnelType: existing.personnelType,
      contractType: existing.contractType,
      cooperativeEnterprise: existing.cooperativeEnterprise,
      cooperativeEmploymentType: existing.cooperativeEmploymentType,
      cooperativeEmploymentSource: existing.cooperativeEmploymentSource,
      employmentManagement: existing.employmentManagement,
      compensationType: existing.compensationType,
      settlementProject: existing.settlementProject,
      notes: existing.notes,
      sourceProfile: existing.sourceProfile,
      sourceFileName: existing.sourceFileName,
      sourceRowNumber: existing.sourceRowNumber,
    } as Prisma.PersonnelUncheckedCreateInput &
      Prisma.PersonnelUncheckedUpdateInput;
  }

  private async bulkUpsertPersonnel(
    tx: Prisma.TransactionClient,
    rows: PreparedPersonnel[],
  ): Promise<void> {
    for (const batch of this.chunks(rows, 500)) {
      const payload = JSON.stringify(
        batch.map((item) => ({ id: item.id, ...item.data })),
      );
      await tx.$executeRaw`
        INSERT INTO "personnel" (
          "id", "personnel_code", "name",
          "personal_phone_ciphertext", "personal_phone_iv", "personal_phone_tag", "personal_phone_blind_index",
          "work_phone_ciphertext", "work_phone_iv", "work_phone_tag", "work_phone_blind_index",
          "organization_path", "first_level_organization", "second_level_organization", "third_level_organization",
          "position_name", "business_line", "position_category", "standard_position", "position_tags",
          "employment_status", "personnel_type", "contract_type", "cooperative_enterprise",
          "cooperative_employment_type", "cooperative_employment_source", "employment_management",
          "compensation_type", "settlement_project", "notes", "active", "source_profile",
          "source_file_name", "source_row_number", "last_synced_at"
        )
        SELECT
          input."id", input."personnelCode", input."name",
          input."personalPhoneCiphertext", input."personalPhoneIv", input."personalPhoneTag", input."personalPhoneBlindIndex",
          input."workPhoneCiphertext", input."workPhoneIv", input."workPhoneTag", input."workPhoneBlindIndex",
          input."organizationPath", input."firstLevelOrganization", input."secondLevelOrganization", input."thirdLevelOrganization",
          input."positionName", input."businessLine", input."positionCategory", input."standardPosition", input."positionTags",
          input."employmentStatus", input."personnelType", input."contractType", input."cooperativeEnterprise",
          input."cooperativeEmploymentType", input."cooperativeEmploymentSource", input."employmentManagement",
          input."compensationType", input."settlementProject", input."notes", input."active",
          input."sourceProfile"::"PersonnelSourceProfile", input."sourceFileName",
          input."sourceRowNumber", input."lastSyncedAt"
        FROM jsonb_to_recordset(${payload}::jsonb) AS input(
          "id" uuid, "personnelCode" text, "name" text,
          "personalPhoneCiphertext" text, "personalPhoneIv" text, "personalPhoneTag" text, "personalPhoneBlindIndex" text,
          "workPhoneCiphertext" text, "workPhoneIv" text, "workPhoneTag" text, "workPhoneBlindIndex" text,
          "organizationPath" text, "firstLevelOrganization" text, "secondLevelOrganization" text, "thirdLevelOrganization" text,
          "positionName" text, "businessLine" text, "positionCategory" text, "standardPosition" text, "positionTags" text,
          "employmentStatus" text, "personnelType" text, "contractType" text, "cooperativeEnterprise" text,
          "cooperativeEmploymentType" text, "cooperativeEmploymentSource" text, "employmentManagement" text,
          "compensationType" text, "settlementProject" text, "notes" text, "active" boolean,
          "sourceProfile" text, "sourceFileName" text, "sourceRowNumber" integer, "lastSyncedAt" timestamptz
        )
        ON CONFLICT ("id") DO UPDATE SET
          "personnel_code" = EXCLUDED."personnel_code",
          "name" = EXCLUDED."name",
          "personal_phone_ciphertext" = EXCLUDED."personal_phone_ciphertext",
          "personal_phone_iv" = EXCLUDED."personal_phone_iv",
          "personal_phone_tag" = EXCLUDED."personal_phone_tag",
          "personal_phone_blind_index" = EXCLUDED."personal_phone_blind_index",
          "work_phone_ciphertext" = EXCLUDED."work_phone_ciphertext",
          "work_phone_iv" = EXCLUDED."work_phone_iv",
          "work_phone_tag" = EXCLUDED."work_phone_tag",
          "work_phone_blind_index" = EXCLUDED."work_phone_blind_index",
          "organization_path" = EXCLUDED."organization_path",
          "first_level_organization" = EXCLUDED."first_level_organization",
          "second_level_organization" = EXCLUDED."second_level_organization",
          "third_level_organization" = EXCLUDED."third_level_organization",
          "position_name" = EXCLUDED."position_name",
          "business_line" = EXCLUDED."business_line",
          "position_category" = EXCLUDED."position_category",
          "standard_position" = EXCLUDED."standard_position",
          "position_tags" = EXCLUDED."position_tags",
          "employment_status" = EXCLUDED."employment_status",
          "personnel_type" = EXCLUDED."personnel_type",
          "contract_type" = EXCLUDED."contract_type",
          "cooperative_enterprise" = EXCLUDED."cooperative_enterprise",
          "cooperative_employment_type" = EXCLUDED."cooperative_employment_type",
          "cooperative_employment_source" = EXCLUDED."cooperative_employment_source",
          "employment_management" = EXCLUDED."employment_management",
          "compensation_type" = EXCLUDED."compensation_type",
          "settlement_project" = EXCLUDED."settlement_project",
          "notes" = EXCLUDED."notes",
          "active" = EXCLUDED."active",
          "source_profile" = EXCLUDED."source_profile",
          "source_file_name" = EXCLUDED."source_file_name",
          "source_row_number" = EXCLUDED."source_row_number",
          "last_synced_at" = EXCLUDED."last_synced_at",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    }
  }

  private async ensurePositions(
    tx: Prisma.TransactionClient,
    rows: ImportedPersonnel[],
    sourceProfile: PersonnelSourceProfile,
  ): Promise<void> {
    if (sourceProfile !== PersonnelSourceProfile.FULL_DIRECTORY) return;
    const names = [
      ...new Set(
        rows
          .flatMap((row) => [row.positionName, row.standardPosition])
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) => value.trim()),
      ),
    ];
    if (!names.length) return;
    await tx.personnelPosition.createMany({
      data: names.map((name) => ({
        name,
        code: `IMPORT_${createHash("sha1")
          .update(name, "utf8")
          .digest("hex")
          .slice(0, 16)
          .toUpperCase()}`,
      })),
      skipDuplicates: true,
    });
  }

  private async loadExistingUserPhoneIndexes(
    db: Prisma.TransactionClient | PrismaService,
    rows: ImportedPersonnel[],
  ): Promise<Set<string>> {
    const indexes = [
      ...new Set(
        rows
          .flatMap((row) => [row.personalPhone, row.workPhone])
          .filter((value): value is string => Boolean(value))
          .map((value) => this.crypto.blindIndex(value)),
      ),
    ];
    const found = new Set<string>();
    for (const batch of this.chunks(indexes, 1_000)) {
      const users = await db.user.findMany({
        where: { phoneBlindIndex: { in: batch } },
        select: { phoneBlindIndex: true },
      });
      for (const user of users) found.add(user.phoneBlindIndex);
    }
    return found;
  }

  private personnelView(
    item: {
      id: string;
      personnelCode: string;
      name: string;
      personalPhoneCiphertext: string | null;
      personalPhoneIv: string | null;
      personalPhoneTag: string | null;
      workPhoneCiphertext: string | null;
      workPhoneIv: string | null;
      workPhoneTag: string | null;
      organizationPath: string | null;
      firstLevelOrganization: string | null;
      secondLevelOrganization: string | null;
      thirdLevelOrganization: string | null;
      positionName: string | null;
      businessLine: string | null;
      positionCategory: string | null;
      standardPosition: string | null;
      positionTags: string | null;
      employmentStatus: string | null;
      personnelType: string | null;
      cooperativeEnterprise: string | null;
      sourceProfile: PersonnelSourceProfile;
      active: boolean;
      lastSyncedAt: Date;
      user?: { id: string } | null;
    },
    templates: Map<string, RoleCode[]>,
  ): PersonnelView {
    const recommendedRoles = [
      ...(item.positionName ? (templates.get(item.positionName) ?? []) : []),
      ...(item.standardPosition
        ? (templates.get(item.standardPosition) ?? [])
        : []),
    ];
    return {
      id: item.id,
      personnelCode: item.personnelCode,
      name: item.name,
      personalPhone: this.decryptPhone(
        item.personalPhoneCiphertext,
        item.personalPhoneIv,
        item.personalPhoneTag,
      ),
      workPhone: this.decryptPhone(
        item.workPhoneCiphertext,
        item.workPhoneIv,
        item.workPhoneTag,
      ),
      organizationPath: item.organizationPath,
      firstLevelOrganization: item.firstLevelOrganization,
      secondLevelOrganization: item.secondLevelOrganization,
      thirdLevelOrganization: item.thirdLevelOrganization,
      positionName: item.positionName,
      businessLine: item.businessLine,
      positionCategory: item.positionCategory,
      standardPosition: item.standardPosition,
      positionTags: item.positionTags,
      employmentStatus: item.employmentStatus,
      personnelType: item.personnelType,
      cooperativeEnterprise: item.cooperativeEnterprise,
      sourceProfile: item.sourceProfile,
      recommendedRoles: [...new Set(recommendedRoles)] as ContractRoleCode[],
      active: item.active,
      userId: item.user?.id ?? null,
      lastSyncedAt: item.lastSyncedAt.toISOString(),
    };
  }

  private positionView(row: {
    id: string;
    code: string;
    name: string;
    enabled: boolean;
    roleTemplates: Array<{ role: RoleCode }>;
  }): PersonnelPositionView {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      enabled: row.enabled,
      roles: row.roleTemplates.map(
        (template) => template.role,
      ) as ContractRoleCode[],
    };
  }

  private importView(row: {
    id: string;
    fileName: string;
    mode: PersonnelImportMode;
    status: "APPLIED" | "FAILED";
    sourceProfile: PersonnelSourceProfile;
    totalRows: number;
    createdRows: number;
    updatedRows: number;
    deactivatedRows: number;
    skippedRows: number;
    accountsCreated: number;
    accountsLinked: number;
    warnings: Prisma.JsonValue | null;
    createdAt: Date;
    completedAt: Date | null;
  }): PersonnelImportView {
    return {
      id: row.id,
      fileName: row.fileName,
      mode: row.mode,
      status: row.status,
      sourceProfile: row.sourceProfile,
      totalRows: row.totalRows,
      createdRows: row.createdRows,
      updatedRows: row.updatedRows,
      deactivatedRows: row.deactivatedRows,
      skippedRows: row.skippedRows,
      accountsCreated: row.accountsCreated,
      accountsLinked: row.accountsLinked,
      warnings: Array.isArray(row.warnings)
        ? row.warnings.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private distinctRoles(roles: RoleCode[]): RoleCode[] {
    return [...new Set(roles)];
  }

  private distinctGrants<T extends { role: RoleCode; districtId?: string }>(
    grants: T[],
  ): T[] {
    const seen = new Set<string>();
    return grants.filter((grant) => {
      const key = `${grant.role}:${grant.districtId ?? "GLOBAL"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async assertEnabledDistricts(
    grants: Array<{ role: RoleCode; districtId?: string }>,
  ): Promise<void> {
    const ids = [
      ...new Set(grants.map((grant) => grant.districtId).filter(Boolean)),
    ] as string[];
    if (!ids.length) return;
    const count = await this.prisma.district.count({
      where: { id: { in: ids }, enabled: true },
    });
    if (count !== ids.length) throw notFound("有效区县不存在");
  }

  private addLookupValue<T>(
    lookup: Map<string, T[]>,
    key: string,
    value: T,
  ): void {
    const current = lookup.get(key);
    if (current) current.push(value);
    else lookup.set(key, [value]);
  }

  private chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size)
      result.push(values.slice(index, index + size));
    return result;
  }

  private cell(
    row: import("exceljs").Row,
    headers: Map<string, number>,
    header: string,
  ) {
    const column = headers.get(header);
    return column ? row.getCell(column).value : null;
  }

  private optionalCell(
    row: import("exceljs").Row,
    headers: Map<string, number>,
    header: string,
  ): string | null {
    const value = this.cellText(this.cell(row, headers, header));
    return value || null;
  }

  private cellText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      if ("text" in value && typeof value.text === "string")
        return value.text.normalize("NFKC").trim();
      if ("result" in value) return this.cellText(value.result);
      if ("richText" in value && Array.isArray(value.richText))
        return value.richText
          .map((part) => part.text ?? "")
          .join("")
          .normalize("NFKC")
          .trim();
    }
    return String(value).normalize("NFKC").trim();
  }

  private phoneText(
    raw: string,
    rowNumber: number,
    header: string,
    warnings: string[],
  ): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    const phone =
      digits.startsWith("86") && digits.length === 13
        ? digits.slice(2)
        : digits;
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      this.warn(warnings, `第 ${rowNumber} 行 ${header} 格式无效`);
      return null;
    }
    return phone;
  }

  private encryptPhone(value: string | null): EncryptedValue | null {
    return value ? this.crypto.encrypt(value) : null;
  }

  private decryptPhone(
    ciphertext: string | null,
    iv: string | null,
    tag: string | null,
  ): string | null {
    if (!ciphertext || !iv || !tag) return null;
    return this.crypto.decrypt({ ciphertext, iv, tag });
  }

  private warn(warnings: string[], warning: string): void {
    if (warnings.length < 200) warnings.push(warning);
  }
}
