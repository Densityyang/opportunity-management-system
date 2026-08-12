import { BadRequestException, Injectable } from "@nestjs/common";
import {
  SPECIFIC_NEED_OPTIONS,
  type OpportunityDetail,
  type OpportunitySummary,
  type PageResult,
  type WorkflowTimelineItem,
} from "@oms/contracts";
import { randomBytes } from "node:crypto";
import type { AuthIdentity } from "../../common/auth.types";
import {
  CryptoService,
  type EncryptedValue,
} from "../../common/crypto.service";
import { forbidden, notFound, versionConflict } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import {
  SubmitOpportunityDto,
  ResubmitOpportunityDto,
  OpportunityListQueryDto,
} from "./opportunity.dto";
import { OpportunityAccessService } from "./opportunity-access.service";
import {
  deserializeSpecificNeeds,
  displaySpecificNeeds,
  serializeSpecificNeeds,
} from "./specific-needs";

type Tx = Prisma.TransactionClient;
type ManagerGrant = { id: string; userId: string };

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly access: OpportunityAccessService,
  ) {}

  async submit(
    identity: AuthIdentity,
    dto: SubmitOpportunityDto,
  ): Promise<OpportunityDetail> {
    if (!dto.consentConfirmed) {
      throw new BadRequestException({
        message: "必须确认客户授权提示",
        errorCode: "CONSENT_REQUIRED",
      });
    }
    const now = new Date();
    const reporterPhone = this.crypto.encrypt(identity.phone);
    const contact = this.crypto.encrypt(dto.customerContact.trim());
    const specificNeeds = this.normalizeSpecificNeeds(dto);
    const need = this.crypto.encrypt(serializeSpecificNeeds(specificNeeds));
    const description = this.optionalEncrypted(dto.oneSentenceDescription);
    const serialNumber = this.serialNumber(now);

    const created = await this.prisma.$transaction(async (tx) => {
      const managers = await this.assertDistrictCoverage(
        tx,
        dto.districtId,
        dto.customerType,
      );
      const item = await tx.opportunity.create({
        data: {
          serialNumber,
          reporterId: identity.id,
          districtId: dto.districtId,
          customerType: dto.customerType,
          attitude: dto.attitude,
          state: "PENDING_FIRST_REVIEW",
          reporterPhoneCiphertext: reporterPhone.ciphertext,
          reporterPhoneIv: reporterPhone.iv,
          reporterPhoneTag: reporterPhone.tag,
          customerContactCiphertext: contact.ciphertext,
          customerContactIv: contact.iv,
          customerContactTag: contact.tag,
          customerContactBlindIndex: this.crypto.blindIndex(
            dto.customerContact,
          ),
          specificNeedCiphertext: need.ciphertext,
          specificNeedIv: need.iv,
          specificNeedTag: need.tag,
          descriptionCiphertext: description?.ciphertext,
          descriptionIv: description?.iv,
          descriptionTag: description?.tag,
          consentAt: now,
          submittedAt: now,
        },
      });
      await tx.opportunityRevision.create({
        data: {
          opportunityId: item.id,
          revisionNumber: 1,
          submittedById: identity.id,
          snapshot: this.encryptedSnapshot(
            dto,
            reporterPhone,
            contact,
            need,
            description,
          ),
        },
      });
      await tx.workflowEvent.create({
        data: {
          opportunityId: item.id,
          eventType: "SUBMITTED",
          toState: "PENDING_FIRST_REVIEW",
          actorUserId: identity.id,
          actorGrantId: identity.activeGrant?.id,
          actorRole: identity.activeGrant?.role,
        },
      });
      const deadlineAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const reminderAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const sla = await tx.slaRound.create({
        data: {
          opportunityId: item.id,
          kind: "FIRST_REVIEW",
          roundNumber: 1,
          startedAt: now,
          reminderAt,
          deadlineAt,
        },
      });
      await tx.notification.createMany({
        data: managers.map((manager) => ({
          recipientUserId: manager.userId,
          recipientGrantId: manager.id,
          opportunityId: item.id,
          type: "FIRST_REVIEW_PENDING",
          title: "有新的商机待初审",
          body: `${serialNumber} 已提交，请在 24 小时内处理。`,
        })),
      });
      await tx.outboxEvent.create({
        data: {
          type: "SLA_ROUND_STARTED",
          aggregateId: item.id,
          payload: { slaRoundId: sla.id },
        },
      });
      return item;
    });
    return this.getDetail(identity, created.id);
  }

  async resubmit(
    identity: AuthIdentity,
    opportunityId: string,
    dto: ResubmitOpportunityDto,
  ): Promise<OpportunityDetail> {
    if (!dto.consentConfirmed)
      throw new BadRequestException({
        message: "必须重新确认客户授权提示",
        errorCode: "CONSENT_REQUIRED",
      });
    const now = new Date();
    const contact = this.crypto.encrypt(dto.customerContact.trim());
    const specificNeeds = this.normalizeSpecificNeeds(dto);
    const need = this.crypto.encrypt(serializeSpecificNeeds(specificNeeds));
    const description = this.optionalEncrypted(dto.oneSentenceDescription);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "opportunities" WHERE id = ${opportunityId}::uuid FOR UPDATE`;
      const current = await tx.opportunity.findUnique({
        where: { id: opportunityId },
      });
      if (!current) throw notFound("商机不存在");
      if (
        current.reporterId !== identity.id ||
        identity.activeGrant?.role !== "FIELD_REPORTER"
      )
        throw forbidden();
      if (current.version !== dto.expectedVersion) throw versionConflict();
      if (current.state !== "RETURNED_TO_REPORTER")
        throw new BadRequestException({
          message: "当前状态不能重新提交",
          errorCode: "INVALID_TRANSITION",
        });
      const managers = await this.assertDistrictCoverage(
        tx,
        dto.districtId,
        dto.customerType,
      );
      const revisionNumber =
        (await tx.opportunityRevision.count({ where: { opportunityId } })) + 1;
      const reporterPhone = {
        ciphertext: current.reporterPhoneCiphertext,
        iv: current.reporterPhoneIv,
        tag: current.reporterPhoneTag,
      };
      await tx.opportunity.update({
        where: { id: opportunityId },
        data: {
          districtId: dto.districtId,
          customerType: dto.customerType,
          attitude: dto.attitude,
          customerContactCiphertext: contact.ciphertext,
          customerContactIv: contact.iv,
          customerContactTag: contact.tag,
          customerContactBlindIndex: this.crypto.blindIndex(
            dto.customerContact,
          ),
          specificNeedCiphertext: need.ciphertext,
          specificNeedIv: need.iv,
          specificNeedTag: need.tag,
          descriptionCiphertext: description?.ciphertext ?? null,
          descriptionIv: description?.iv ?? null,
          descriptionTag: description?.tag ?? null,
          consentAt: now,
          submittedAt: now,
          state: "PENDING_FIRST_REVIEW",
          version: { increment: 1 },
        },
      });
      await tx.opportunityRevision.create({
        data: {
          opportunityId,
          revisionNumber,
          submittedById: identity.id,
          snapshot: this.encryptedSnapshot(
            dto,
            reporterPhone,
            contact,
            need,
            description,
          ),
        },
      });
      await tx.workflowEvent.create({
        data: {
          opportunityId,
          eventType: "REPORTER_RESUBMIT",
          fromState: "RETURNED_TO_REPORTER",
          toState: "PENDING_FIRST_REVIEW",
          actorUserId: identity.id,
          actorGrantId: identity.activeGrant.id,
          actorRole: identity.activeGrant.role,
        },
      });
      const roundNumber =
        (await tx.slaRound.count({
          where: { opportunityId, kind: "FIRST_REVIEW" },
        })) + 1;
      const sla = await tx.slaRound.create({
        data: {
          opportunityId,
          kind: "FIRST_REVIEW",
          roundNumber,
          startedAt: now,
          reminderAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
          deadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      await tx.notification.createMany({
        data: managers.map((manager) => ({
          recipientUserId: manager.userId,
          recipientGrantId: manager.id,
          opportunityId,
          type: "FIRST_REVIEW_RESUBMITTED",
          title: "退回商机已重新提交",
          body: `${current.serialNumber} 已重新提交，请在新的 24 小时周期内处理。`,
        })),
      });
      await tx.outboxEvent.create({
        data: {
          type: "SLA_ROUND_STARTED",
          aggregateId: opportunityId,
          payload: { slaRoundId: sla.id },
        },
      });
    });
    return this.getDetail(identity, opportunityId);
  }

  async list(
    identity: AuthIdentity,
    query: OpportunityListQueryDto,
  ): Promise<PageResult<OpportunitySummary>> {
    const grant = identity.activeGrant;
    if (!grant || grant.role === "SYSTEM_ADMIN")
      throw forbidden("系统管理员默认无权查看商机内容");
    const roleWhere =
      grant.role === "FIELD_REPORTER"
        ? { reporterId: identity.id }
        : grant.role === "DISTRICT_MANAGER"
          ? { districtId: grant.districtId! }
          : ["MUNICIPAL", "SENIOR_MUNICIPAL_ADMIN"].includes(grant.role)
            ? { state: "CLOSED_SUCCESS" as const }
            : {
                assignments: {
                  some: { handlerGrantId: grant.id, active: true },
                },
              };
    const where = {
      AND: [
        roleWhere,
        ...(query.state ? [{ state: query.state }] : []),
        ...(query.districtId ? [{ districtId: query.districtId }] : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: {
          district: true,
          result: true,
          slaRounds: {
            where: { status: "ACTIVE" },
            take: 1,
            orderBy: { startedAt: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toSummary(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getDetail(
    identity: AuthIdentity,
    opportunityId: string,
  ): Promise<OpportunityDetail> {
    const item = await this.access.loadReadable(identity, opportunityId);
    const summary = this.toSummary(item);
    const storedSpecificNeeds = this.crypto.decrypt({
      ciphertext: item.specificNeedCiphertext,
      iv: item.specificNeedIv,
      tag: item.specificNeedTag,
    });
    const specificNeeds = deserializeSpecificNeeds(storedSpecificNeeds);
    return {
      ...summary,
      reporterPhone: this.crypto.decrypt({
        ciphertext: item.reporterPhoneCiphertext,
        iv: item.reporterPhoneIv,
        tag: item.reporterPhoneTag,
      }),
      customerContact: this.crypto.decrypt({
        ciphertext: item.customerContactCiphertext,
        iv: item.customerContactIv,
        tag: item.customerContactTag,
      }),
      specificNeed: displaySpecificNeeds(storedSpecificNeeds),
      specificNeeds,
      consentAt: item.consentAt.toISOString(),
      failureReason:
        item.result?.failureReasonCiphertext &&
        item.result.failureReasonIv &&
        item.result.failureReasonTag
          ? this.crypto.decrypt({
              ciphertext: item.result.failureReasonCiphertext,
              iv: item.result.failureReasonIv,
              tag: item.result.failureReasonTag,
            })
          : null,
      pausedUntil: item.pausedUntil?.toISOString() ?? null,
      audio: item.audio
        ? {
            id: item.audio.id,
            mimeType: item.audio.mimeType,
            durationMs: item.audio.durationMs,
            deletedAt: item.audio.deletedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async timeline(
    identity: AuthIdentity,
    opportunityId: string,
  ): Promise<WorkflowTimelineItem[]> {
    await this.access.loadReadable(identity, opportunityId);
    const events = await this.prisma.workflowEvent.findMany({
      where: { opportunityId },
      include: { actor: true },
      orderBy: { occurredAt: "asc" },
    });
    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      fromState: event.fromState,
      toState: event.toState,
      actorName: event.actor?.displayName ?? null,
      actorRole: event.actorRole,
      keyPersonName: this.timelineKeyPersonName(event.metadata),
      note:
        event.noteCiphertext && event.noteIv && event.noteTag
          ? this.crypto.decrypt({
              ciphertext: event.noteCiphertext,
              iv: event.noteIv,
              tag: event.noteTag,
            })
          : null,
      occurredAt: event.occurredAt.toISOString(),
    }));
  }

  private toSummary(item: any): OpportunitySummary {
    const sla = item.slaRounds?.[0] as
      { deadlineAt: Date; overdueMarkedAt: Date | null } | undefined;
    return {
      id: item.id,
      serialNumber: item.serialNumber,
      state: item.state,
      version: item.version,
      customerType: item.customerType,
      attitude: item.attitude,
      district: {
        id: item.district.id,
        code: item.district.code,
        name: item.district.name,
        enabled: item.district.enabled,
        sortOrder: item.district.sortOrder,
      },
      oneSentenceDescription:
        item.descriptionCiphertext && item.descriptionIv && item.descriptionTag
          ? this.crypto.decrypt({
              ciphertext: item.descriptionCiphertext,
              iv: item.descriptionIv,
              tag: item.descriptionTag,
            })
          : null,
      successOpportunityName:
        item.result?.successNameCiphertext &&
        item.result.successNameIv &&
        item.result.successNameTag
          ? this.crypto.decrypt({
              ciphertext: item.result.successNameCiphertext,
              iv: item.result.successNameIv,
              tag: item.result.successNameTag,
            })
          : null,
      submittedAt: item.submittedAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      currentSlaDeadline: sla?.deadlineAt.toISOString() ?? null,
      currentSlaOverdue: Boolean(
        sla && (sla.overdueMarkedAt || sla.deadlineAt <= new Date()),
      ),
    };
  }

  private optionalEncrypted(value?: string): EncryptedValue | null {
    const normalized = value?.trim();
    return normalized ? this.crypto.encrypt(normalized) : null;
  }

  private normalizeSpecificNeeds(dto: { specificNeeds: string[] }): string[] {
    const values = dto.specificNeeds.map((value) => value.trim());
    const unique = [...new Set(values)];
    if (
      unique.length < 1 ||
      unique.length > 2 ||
      unique.length !== values.length ||
      unique.some(
        (value) =>
          !(SPECIFIC_NEED_OPTIONS as readonly string[]).includes(value),
      )
    ) {
      throw new BadRequestException({
        message: "具体需求必须从菜单中选择，且最多选择两项",
        errorCode: "INVALID_SPECIFIC_NEEDS",
      });
    }
    return unique;
  }

  private encryptedSnapshot(
    dto: SubmitOpportunityDto,
    reporterPhone: EncryptedValue,
    contact: EncryptedValue,
    need: EncryptedValue,
    description: EncryptedValue | null,
  ) {
    return {
      customerType: dto.customerType,
      districtId: dto.districtId,
      attitude: dto.attitude,
      reporterPhone: this.snapshotValue(reporterPhone),
      customerContact: this.snapshotValue(contact),
      specificNeed: this.snapshotValue(need),
      oneSentenceDescription: description
        ? this.snapshotValue(description)
        : null,
      consentConfirmed: true,
    } as Prisma.InputJsonValue;
  }

  private snapshotValue(value: EncryptedValue): Record<string, string> {
    return { ciphertext: value.ciphertext, iv: value.iv, tag: value.tag };
  }

  private timelineKeyPersonName(
    metadata: Prisma.JsonValue | null,
  ): string | null {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== "object")
      return null;
    const value = metadata.keyPersonName;
    return typeof value === "string" ? value : null;
  }

  private async assertDistrictCoverage(
    tx: Tx,
    districtId: string,
    customerType: "PERSONAL" | "ORGANIZATION",
  ): Promise<ManagerGrant[]> {
    const district = await tx.district.findUnique({
      where: { id: districtId },
      select: { enabled: true },
    });
    if (!district?.enabled)
      throw new BadRequestException({
        message: "该商机承载区域当前不可用",
        errorCode: "DISTRICT_UNAVAILABLE",
      });

    const handlerRole =
      customerType === "PERSONAL" ? "PERSONAL_HANDLER" : "ORGANIZATION_HANDLER";
    const grants = await tx.roleGrant.findMany({
      where: {
        districtId,
        role: { in: ["DISTRICT_MANAGER", handlerRole] },
        active: true,
        user: { active: true },
      },
      select: { id: true, userId: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    const managers = [
      ...new Map(
        grants
          .filter((grant) => grant.role === "DISTRICT_MANAGER")
          .map((grant) => [
            grant.userId,
            { id: grant.id, userId: grant.userId },
          ]),
      ).values(),
    ];
    const hasHandler = grants.some((grant) => grant.role === handlerRole);
    if (!managers.length || !hasHandler)
      throw new BadRequestException({
        message: `该区域尚未配置有效的区县经理或${
          customerType === "PERSONAL" ? "个人侧" : "组织侧"
        }承接人`,
        errorCode: "DISTRICT_COVERAGE_NOT_CONFIGURED",
      });
    return managers;
  }

  private serialNumber(now: Date): string {
    const day = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(now)
      .replaceAll("/", "");
    return `SJ${day}${randomBytes(4).toString("hex").toUpperCase()}`;
  }
}
