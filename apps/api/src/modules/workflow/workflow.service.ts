import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import type { AuthIdentity } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import {
  forbidden,
  invalidTransition,
  notFound,
  versionConflict,
} from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import type {
  OpportunityState,
  ResultKind,
  RoleCode,
  SlaKind,
} from "../../generated/prisma/enums";
import type {
  ExpectedVersionDto,
  FailureResultDto,
  FirstApproveDto,
  PauseDto,
  ReassignDto,
  ReturnDto,
  SuccessResultDto,
} from "../opportunities/opportunity.dto";
import {
  getNextWorkflowState,
  type WorkflowEventType,
} from "./workflow.machine";

type Tx = Prisma.TransactionClient;
type TransitionResult = {
  id: string;
  state: OpportunityState;
  version: number;
};
type LockedOpportunity = {
  id: string;
  serialNumber: string;
  reporterId: string;
  districtId: string;
  customerType: "PERSONAL" | "ORGANIZATION";
  state: OpportunityState;
  version: number;
  pausedUntil: Date | null;
  assignments: Array<{ handlerGrantId: string }>;
  result: { kind: ResultKind } | null;
} | null;

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  firstApprove(
    identity: AuthIdentity,
    opportunityId: string,
    dto: FirstApproveDto,
    key?: string,
  ) {
    return this.execute(
      identity,
      opportunityId,
      "FIRST_APPROVE",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertManager(identity, item.districtId);
        const expectedRole: RoleCode =
          item.customerType === "PERSONAL"
            ? "PERSONAL_HANDLER"
            : "ORGANIZATION_HANDLER";
        const handler = await tx.roleGrant.findUnique({
          where: { id: dto.handlerGrantId },
          include: { user: true },
        });
        if (
          !handler?.active ||
          !handler.user.active ||
          handler.role !== expectedRole ||
          handler.districtId !== item.districtId
        ) {
          throw new BadRequestException({
            message: "承接人必须为本区县有效且分侧角色匹配的账号",
            errorCode: "INVALID_HANDLER",
          });
        }
        await this.replaceAssignment(
          tx,
          item.id,
          handler.id,
          identity.id,
          null,
        );
        await this.closeActiveSla(tx, item.id, "FIRST_REVIEW");
        await this.notifyGrant(
          tx,
          handler.id,
          item.id,
          "HANDLING_ASSIGNED",
          "收到新的承接任务",
          `${item.serialNumber} 已通过区县初审。`,
        );
        await this.notifyReporter(
          tx,
          item,
          "FIRST_REVIEW_APPROVED",
          "商机已通过区县初审",
          `${item.serialNumber} 已交由 ${handler.user.displayName} 处理。`,
        );
        return {
          keyPersonName: handler.user.displayName,
          keyPersonRole: handler.role,
          handlerGrantId: handler.id,
        };
      },
    );
  }

  firstReturn(
    identity: AuthIdentity,
    opportunityId: string,
    dto: ReturnDto,
    key?: string,
  ) {
    const reason = this.requiredText(dto.reason, "退回原因");
    return this.execute(
      identity,
      opportunityId,
      "FIRST_RETURN",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertManager(identity, item.districtId);
        await this.closeActiveSla(tx, item.id, "FIRST_REVIEW");
        await this.notifyReporter(
          tx,
          item,
          "FIRST_REVIEW_RETURNED",
          "商机被退回修改",
          reason,
        );
      },
      reason,
    );
  }

  reassign(
    identity: AuthIdentity,
    opportunityId: string,
    dto: ReassignDto,
    key?: string,
  ) {
    const reason = this.requiredText(dto.reason, "改派原因");
    return this.execute(
      identity,
      opportunityId,
      "REASSIGN",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertManager(identity, item.districtId);
        const expectedRole: RoleCode =
          item.customerType === "PERSONAL"
            ? "PERSONAL_HANDLER"
            : "ORGANIZATION_HANDLER";
        const handler = await tx.roleGrant.findUnique({
          where: { id: dto.handlerGrantId },
          include: { user: true },
        });
        if (
          !handler?.active ||
          !handler.user.active ||
          handler.role !== expectedRole ||
          handler.districtId !== item.districtId
        ) {
          throw new BadRequestException({
            message: "新承接人必须属于本区县且分侧角色匹配",
            errorCode: "INVALID_HANDLER",
          });
        }
        await this.replaceAssignment(
          tx,
          item.id,
          handler.id,
          identity.id,
          reason,
        );
        await this.notifyGrant(
          tx,
          handler.id,
          item.id,
          "HANDLER_REASSIGNED",
          "收到改派商机",
          `${item.serialNumber} 已改派给你。`,
        );
        await this.notifyReporter(
          tx,
          item,
          "HANDLER_REASSIGNED",
          "商机承接人已调整",
          `${item.serialNumber} 的处理责任人已调整为 ${handler.user.displayName}。`,
        );
        return {
          keyPersonName: handler.user.displayName,
          keyPersonRole: handler.role,
          handlerGrantId: handler.id,
        };
      },
      reason,
    );
  }

  pause(
    identity: AuthIdentity,
    opportunityId: string,
    dto: PauseDto,
    key?: string,
  ) {
    const nextProcessingAt = new Date(dto.nextProcessingAt);
    const now = new Date();
    if (
      nextProcessingAt <= now ||
      nextProcessingAt.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException({
        message: "下次处理时间必须在未来一年内",
        errorCode: "INVALID_NEXT_PROCESSING_AT",
      });
    }
    return this.execute(
      identity,
      opportunityId,
      "HANDLER_PAUSE",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertHandler(identity, item);
        await tx.opportunity.update({
          where: { id: item.id },
          data: { pausedUntil: nextProcessingAt },
        });
        await tx.outboxEvent.create({
          data: {
            type: "PAUSE_SCHEDULED",
            aggregateId: item.id,
            payload: {
              opportunityId: item.id,
              expectedVersion: item.version + 1,
              resumeAt: nextProcessingAt.toISOString(),
            },
          },
        });
        await this.notifyReporter(
          tx,
          item,
          "HANDLING_PAUSED",
          "商机暂缓处理",
          `${item.serialNumber} 将于 ${this.shanghaiTime(nextProcessingAt)} 继续处理。`,
        );
      },
      `下次处理时间：${this.shanghaiTime(nextProcessingAt)}`,
    );
  }

  resume(
    identity: AuthIdentity,
    opportunityId: string,
    dto: ExpectedVersionDto,
    key?: string,
  ) {
    return this.execute(
      identity,
      opportunityId,
      "HANDLER_RESUME",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertHandler(identity, item);
        await tx.opportunity.update({
          where: { id: item.id },
          data: { pausedUntil: null },
        });
        await this.notifyReporter(
          tx,
          item,
          "HANDLING_RESUMED",
          "商机已恢复处理",
          `${item.serialNumber} 已恢复处理。`,
        );
      },
    );
  }

  submitSuccess(
    identity: AuthIdentity,
    opportunityId: string,
    dto: SuccessResultDto,
    key?: string,
  ) {
    const name = this.requiredText(dto.successOpportunityName, "成功商机名称");
    return this.execute(
      identity,
      opportunityId,
      "SUBMIT_SUCCESS",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertHandler(identity, item);
        const encrypted = this.crypto.encrypt(name);
        await tx.handlingResult.upsert({
          where: { opportunityId: item.id },
          create: {
            opportunityId: item.id,
            kind: "SUCCESS",
            successNameCiphertext: encrypted.ciphertext,
            successNameIv: encrypted.iv,
            successNameTag: encrypted.tag,
            successNameSearchTokens: this.crypto.searchTokens(name),
            submittedByGrantId: identity.activeGrant!.id,
            submittedAt: new Date(),
          },
          update: {
            kind: "SUCCESS",
            successNameCiphertext: encrypted.ciphertext,
            successNameIv: encrypted.iv,
            successNameTag: encrypted.tag,
            successNameSearchTokens: this.crypto.searchTokens(name),
            failureReasonCiphertext: null,
            failureReasonIv: null,
            failureReasonTag: null,
            submittedByGrantId: identity.activeGrant!.id,
            submittedAt: new Date(),
            finalApprovedAt: null,
          },
        });
        await this.startFinalReview(tx, item);
      },
    );
  }

  submitFailure(
    identity: AuthIdentity,
    opportunityId: string,
    dto: FailureResultDto,
    key?: string,
  ) {
    const reason = this.requiredText(dto.failureReason, "失败原因");
    return this.execute(
      identity,
      opportunityId,
      "SUBMIT_FAILURE",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertHandler(identity, item);
        const encrypted = this.crypto.encrypt(reason);
        await tx.handlingResult.upsert({
          where: { opportunityId: item.id },
          create: {
            opportunityId: item.id,
            kind: "FAILURE",
            successNameSearchTokens: [],
            failureReasonCiphertext: encrypted.ciphertext,
            failureReasonIv: encrypted.iv,
            failureReasonTag: encrypted.tag,
            submittedByGrantId: identity.activeGrant!.id,
            submittedAt: new Date(),
          },
          update: {
            kind: "FAILURE",
            failureReasonCiphertext: encrypted.ciphertext,
            failureReasonIv: encrypted.iv,
            failureReasonTag: encrypted.tag,
            successNameCiphertext: null,
            successNameIv: null,
            successNameTag: null,
            successNameSearchTokens: [],
            submittedByGrantId: identity.activeGrant!.id,
            submittedAt: new Date(),
            finalApprovedAt: null,
          },
        });
        await this.startFinalReview(tx, item);
      },
    );
  }

  finalReturn(
    identity: AuthIdentity,
    opportunityId: string,
    dto: ReturnDto,
    key?: string,
  ) {
    const reason = this.requiredText(dto.reason, "退回原因");
    return this.execute(
      identity,
      opportunityId,
      "FINAL_RETURN",
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertManager(identity, item.districtId);
        await this.closeActiveSla(tx, item.id, "FINAL_REVIEW");
        const assignment = item.assignments[0];
        if (assignment) {
          await this.notifyGrant(
            tx,
            assignment.handlerGrantId,
            item.id,
            "FINAL_REVIEW_RETURNED",
            "处理结果被退回",
            reason,
          );
        }
        await this.notifyReporter(
          tx,
          item,
          "FINAL_REVIEW_RETURNED",
          "处理结果需补充",
          `${item.serialNumber} 的处理结果被区县经理退回。`,
        );
      },
      reason,
    );
  }

  async finalApprove(
    identity: AuthIdentity,
    opportunityId: string,
    dto: ExpectedVersionDto,
    key?: string,
  ) {
    const current = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: { result: true },
    });
    if (!current) throw notFound("商机不存在");
    if (!current.result)
      throw new BadRequestException({
        message: "处理结果不存在",
        errorCode: "RESULT_REQUIRED",
      });
    const event: WorkflowEventType =
      current.result.kind === "SUCCESS"
        ? "FINAL_APPROVE_SUCCESS"
        : "FINAL_APPROVE_FAILURE";
    return this.execute(
      identity,
      opportunityId,
      event,
      dto.expectedVersion,
      key,
      dto,
      async (tx, item) => {
        this.assertManager(identity, item.districtId);
        const result = await tx.handlingResult.findUnique({
          where: { opportunityId: item.id },
        });
        const expectedKind: ResultKind =
          event === "FINAL_APPROVE_SUCCESS" ? "SUCCESS" : "FAILURE";
        if (!result || result.kind !== expectedKind) throw invalidTransition();
        const now = new Date();
        await this.closeActiveSla(tx, item.id, "FINAL_REVIEW");
        await tx.handlingResult.update({
          where: { opportunityId: item.id },
          data: { finalApprovedAt: now },
        });
        const audioDays = Number(process.env.AUDIO_RETENTION_DAYS ?? 90);
        await tx.audioRecord.updateMany({
          where: { opportunityId: item.id, status: "ACTIVE" },
          data: {
            deleteAfter: new Date(
              now.getTime() + audioDays * 24 * 60 * 60 * 1000,
            ),
          },
        });
        const eligibleAt = new Date(now);
        eligibleAt.setUTCFullYear(
          eligibleAt.getUTCFullYear() +
            Number(process.env.DATA_RETENTION_YEARS ?? 3),
        );
        await tx.retentionCandidate.upsert({
          where: { opportunityId: item.id },
          create: {
            opportunityId: item.id,
            eligibleAt,
            suggestedAction: "ANONYMIZE",
          },
          update: { eligibleAt, status: "PENDING" },
        });
        const assignment = item.assignments[0];
        if (assignment) {
          await this.notifyGrant(
            tx,
            assignment.handlerGrantId,
            item.id,
            "FINAL_REVIEW_APPROVED",
            "处理结果已审核通过",
            `${item.serialNumber} 已办结。`,
          );
        }
        await this.notifyReporter(
          tx,
          item,
          "OPPORTUNITY_CLOSED",
          "商机已完成处理",
          `${item.serialNumber} 已由区县经理审核办结。`,
        );
      },
      undefined,
      { closedAt: new Date() },
    );
  }

  async autoResume(
    opportunityId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "opportunities" WHERE id = ${opportunityId}::uuid FOR UPDATE`;
      const item = await this.loadLocked(tx, opportunityId);
      if (
        !item ||
        item.state !== "PAUSED" ||
        item.version !== expectedVersion ||
        !item.pausedUntil ||
        item.pausedUntil > new Date()
      )
        return false;
      const next = getNextWorkflowState(item.state, "AUTO_RESUME");
      if (!next) return false;
      await tx.opportunity.update({
        where: { id: item.id },
        data: { state: next, version: { increment: 1 }, pausedUntil: null },
      });
      await tx.workflowEvent.create({
        data: {
          opportunityId: item.id,
          eventType: "AUTO_RESUME",
          fromState: item.state,
          toState: next,
          metadata: { trigger: "scheduled" },
        },
      });
      const assignment = item.assignments[0];
      if (assignment)
        await this.notifyGrant(
          tx,
          assignment.handlerGrantId,
          item.id,
          "AUTO_RESUMED",
          "暂缓商机到期",
          `${item.serialNumber} 已自动恢复，请继续处理。`,
        );
      await this.notifyReporter(
        tx,
        item,
        "HANDLING_RESUMED",
        "商机已恢复处理",
        `${item.serialNumber} 已按约定时间恢复处理。`,
      );
      return true;
    });
  }

  private async execute(
    identity: AuthIdentity,
    opportunityId: string,
    event: WorkflowEventType,
    expectedVersion: number,
    idempotencyKey: string | undefined,
    requestBody: unknown,
    mutate: (
      tx: Tx,
      item: NonNullable<LockedOpportunity>,
    ) => Promise<Prisma.InputJsonValue | void>,
    note?: string,
    extraUpdate: Prisma.OpportunityUpdateInput = {},
  ): Promise<TransitionResult> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    if (!identity.activeGrant) throw forbidden("必须选择当前角色");
    const scope = `${identity.id}:${identity.activeGrant.id}:${opportunityId}:${event}`;
    const requestHash = this.crypto.requestHash(requestBody);
    const cached = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (cached) {
      if (cached.requestHash !== requestHash)
        throw new ConflictException({
          message: "幂等键已用于不同请求",
          errorCode: "IDEMPOTENCY_KEY_REUSED",
        });
      return cached.responseBody as unknown as TransitionResult;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "opportunities" WHERE id = ${opportunityId}::uuid FOR UPDATE`;
      const repeated = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope, key } },
      });
      if (repeated) {
        if (repeated.requestHash !== requestHash)
          throw new ConflictException({
            message: "幂等键已用于不同请求",
            errorCode: "IDEMPOTENCY_KEY_REUSED",
          });
        return repeated.responseBody as unknown as TransitionResult;
      }
      const item = await this.loadLocked(tx, opportunityId);
      if (!item) throw notFound("商机不存在");
      if (item.version !== expectedVersion) throw versionConflict();
      const nextState = getNextWorkflowState(item.state, event);
      if (!nextState) throw invalidTransition();
      const eventMetadata = await mutate(tx, item);
      const encryptedNote = note ? this.crypto.encrypt(note) : null;
      const updated = await tx.opportunity.update({
        where: { id: item.id },
        data: { ...extraUpdate, state: nextState, version: { increment: 1 } },
      });
      await tx.workflowEvent.create({
        data: {
          opportunityId: item.id,
          eventType: event,
          fromState: item.state,
          toState: nextState,
          actorUserId: identity.id,
          actorGrantId: identity.activeGrant!.id,
          actorRole: identity.activeGrant!.role,
          noteCiphertext: encryptedNote?.ciphertext,
          noteIv: encryptedNote?.iv,
          noteTag: encryptedNote?.tag,
          metadata: eventMetadata ?? undefined,
        },
      });
      const response: TransitionResult = {
        id: item.id,
        state: updated.state,
        version: updated.version,
      };
      await tx.idempotencyRecord.create({
        data: {
          scope,
          key,
          requestHash,
          responseStatus: 200,
          responseBody: response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return response;
    });
  }

  private loadLocked(tx: Tx, opportunityId: string) {
    return tx.opportunity.findUnique({
      where: { id: opportunityId },
      include: { assignments: { where: { active: true } }, result: true },
    });
  }

  private assertManager(identity: AuthIdentity, districtId: string): void {
    if (
      identity.activeGrant?.role !== "DISTRICT_MANAGER" ||
      identity.activeGrant.districtId !== districtId
    )
      throw forbidden("仅本区县经理可审核");
  }

  private assertHandler(
    identity: AuthIdentity,
    item: NonNullable<LockedOpportunity>,
  ): void {
    if (
      !identity.activeGrant ||
      !["PERSONAL_HANDLER", "ORGANIZATION_HANDLER"].includes(
        identity.activeGrant.role,
      ) ||
      !item.assignments.some(
        (assignment) => assignment.handlerGrantId === identity.activeGrant!.id,
      )
    ) {
      throw forbidden("仅当前承接人可处理");
    }
  }

  private async replaceAssignment(
    tx: Tx,
    opportunityId: string,
    handlerGrantId: string,
    assignedById: string,
    reason: string | null,
  ) {
    await tx.assignment.updateMany({
      where: { opportunityId, active: true },
      data: { active: false, endedAt: new Date() },
    });
    const encrypted = reason ? this.crypto.encrypt(reason) : null;
    await tx.assignment.create({
      data: {
        opportunityId,
        handlerGrantId,
        assignedById,
        reasonCiphertext: encrypted?.ciphertext,
        reasonIv: encrypted?.iv,
        reasonTag: encrypted?.tag,
      },
    });
  }

  private async startFinalReview(
    tx: Tx,
    item: NonNullable<LockedOpportunity>,
  ): Promise<void> {
    const now = new Date();
    const roundNumber =
      (await tx.slaRound.count({
        where: { opportunityId: item.id, kind: "FINAL_REVIEW" },
      })) + 1;
    const sla = await tx.slaRound.create({
      data: {
        opportunityId: item.id,
        kind: "FINAL_REVIEW",
        roundNumber,
        startedAt: now,
        reminderAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        deadlineAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      },
    });
    await this.notifyDistrictManagers(
      tx,
      item.districtId,
      item.id,
      "FINAL_REVIEW_PENDING",
      "处理结果待审核",
      `${item.serialNumber} 已提交处理结果，请在 48 小时内审核。`,
    );
    await this.notifyReporter(
      tx,
      item,
      "RESULT_SUBMITTED",
      "处理结果已提交审核",
      `${item.serialNumber} 已重新流转至区县经理审核。`,
    );
    await tx.outboxEvent.create({
      data: {
        type: "SLA_ROUND_STARTED",
        aggregateId: item.id,
        payload: { slaRoundId: sla.id },
      },
    });
  }

  private async closeActiveSla(
    tx: Tx,
    opportunityId: string,
    kind: SlaKind,
  ): Promise<void> {
    await tx.slaRound.updateMany({
      where: { opportunityId, kind, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  private async notifyGrant(
    tx: Tx,
    grantId: string,
    opportunityId: string,
    type: string,
    title: string,
    body: string,
  ) {
    const grant = await tx.roleGrant.findUnique({
      where: { id: grantId },
      include: { user: true },
    });
    if (!grant?.active || !grant.user.active) return;
    await tx.notification.create({
      data: {
        recipientUserId: grant.userId,
        recipientGrantId: grant.id,
        opportunityId,
        type,
        title,
        body,
      },
    });
  }

  private async notifyDistrictManagers(
    tx: Tx,
    districtId: string,
    opportunityId: string,
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    const grants = await tx.roleGrant.findMany({
      where: {
        districtId,
        role: "DISTRICT_MANAGER",
        active: true,
        user: { active: true },
      },
      orderBy: { createdAt: "asc" },
    });
    const managers = [
      ...new Map(grants.map((grant) => [grant.userId, grant])).values(),
    ];
    if (!managers.length)
      throw new BadRequestException({
        message: "该区县尚未配置有效区县经理",
        errorCode: "DISTRICT_MANAGER_NOT_CONFIGURED",
      });
    await tx.notification.createMany({
      data: managers.map((grant) => ({
        recipientUserId: grant.userId,
        recipientGrantId: grant.id,
        opportunityId,
        type,
        title,
        body,
      })),
    });
  }

  private async notifyReporter(
    tx: Tx,
    item: { id: string; reporterId: string },
    type: string,
    title: string,
    body: string,
  ) {
    await tx.notification.create({
      data: {
        recipientUserId: item.reporterId,
        opportunityId: item.id,
        type,
        title,
        body,
      },
    });
  }

  private requiredText(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed)
      throw new BadRequestException({
        message: `${label}不能为空`,
        errorCode: "EMPTY_TEXT",
      });
    return trimmed;
  }

  private requireIdempotencyKey(value?: string): string {
    const key = value?.trim();
    if (!key || key.length > 160) {
      throw new BadRequestException({
        message: "必须提供有效的 Idempotency-Key",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    return key;
  }

  private shanghaiTime(date: Date): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
    }).format(date);
  }
}
