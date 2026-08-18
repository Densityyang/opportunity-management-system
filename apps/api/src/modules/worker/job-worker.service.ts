import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PgBoss } from "pg-boss";
import { PrismaService } from "../../common/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AudioService } from "../audio/audio.service";
import { PersonnelBatchService } from "../admin/personnel-batch.service";
import { WorkflowService } from "../workflow/workflow.service";

interface SlaJobData {
  slaRoundId: string;
}
interface ResumeJobData {
  opportunityId: string;
  expectedVersion: number;
}
interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private readonly boss: PgBoss;
  private outboxTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly audio: AudioService,
    private readonly personnelBatch: PersonnelBatchService,
  ) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    this.boss = new PgBoss(connectionString);
    this.boss.on("error", (error) => this.logger.error("pg-boss error", error));
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    for (const queue of [
      "sla-reminder",
      "sla-overdue",
      "pause-resume",
      "personnel-account-batch",
    ])
      await this.boss.createQueue(queue);
    await this.boss.work<SlaJobData>("sla-reminder", async ([job]) => {
      if (!job) return;
      await this.handleSlaReminder(job.data.slaRoundId);
    });
    await this.boss.work<SlaJobData>("sla-overdue", async ([job]) => {
      if (!job) return;
      await this.handleSlaOverdue(job.data.slaRoundId);
    });
    await this.boss.work<ResumeJobData>("pause-resume", async ([job]) => {
      if (!job) return;
      await this.workflow.autoResume(
        job.data.opportunityId,
        job.data.expectedVersion,
      );
    });
    await this.boss.work<{ batchId: string }>(
      "personnel-account-batch",
      async ([job]) => {
        if (!job) return;
        await this.personnelBatch.processBatch(job.data.batchId);
      },
    );
    await this.pumpOutbox();
    await this.audio.deleteExpired();
    this.outboxTimer = setInterval(() => void this.pumpOutbox(), 5_000);
    this.cleanupTimer = setInterval(
      () => void this.maintenance(),
      60 * 60 * 1000,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  private async pumpOutbox(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT "id", "type", "payload" FROM "outbox_events"
        WHERE "processed_at" IS NULL AND "available_at" <= now()
        ORDER BY "created_at"
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      `;
      for (const event of rows) {
        try {
          const payload = event.payload as Record<string, unknown>;
          if (event.type === "SLA_ROUND_STARTED") {
            const slaRoundId = String(payload.slaRoundId);
            const round = await tx.slaRound.findUnique({
              where: { id: slaRoundId },
            });
            if (round?.status === "ACTIVE") {
              await this.boss.send(
                "sla-reminder",
                { slaRoundId },
                {
                  startAfter: round.reminderAt,
                  singletonKey: `${slaRoundId}:reminder`,
                  retryLimit: 5,
                  retryBackoff: true,
                },
              );
              await this.boss.send(
                "sla-overdue",
                { slaRoundId },
                {
                  startAfter: round.deadlineAt,
                  singletonKey: `${slaRoundId}:overdue`,
                  retryLimit: 5,
                  retryBackoff: true,
                },
              );
            }
          } else if (event.type === "PAUSE_SCHEDULED") {
            await this.boss.send(
              "pause-resume",
              {
                opportunityId: String(payload.opportunityId),
                expectedVersion: Number(payload.expectedVersion),
              },
              {
                startAfter: new Date(String(payload.resumeAt)),
                singletonKey: `${payload.opportunityId}:${payload.expectedVersion}`,
                retryLimit: 5,
                retryBackoff: true,
              },
            );
          } else if (event.type === "PERSONNEL_ACCOUNT_BATCH_REQUESTED") {
            const batchId = String(payload.batchId);
            await this.boss.send(
              "personnel-account-batch",
              { batchId },
              {
                singletonKey: `personnel-account-batch:${batchId}`,
                retryLimit: 5,
                retryBackoff: true,
              },
            );
          }
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: {
              processedAt: new Date(),
              attempts: { increment: 1 },
              lastError: null,
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: message.slice(0, 1000),
              availableAt: new Date(Date.now() + 30_000),
            },
          });
        }
      }
    });
  }

  private async handleSlaReminder(slaRoundId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const round = await tx.slaRound.findUnique({
        where: { id: slaRoundId },
        include: { opportunity: true },
      });
      if (
        !round ||
        round.status !== "ACTIVE" ||
        round.reminderSentAt ||
        round.reminderAt > new Date()
      )
        return;
      await this.notifyDistrictManagers(
        tx,
        round.opportunity.districtId,
        round.opportunityId,
        "SLA_HALF_REMINDER",
        "审批时限已过半",
        `${round.opportunity.serialNumber} 的${round.kind === "FIRST_REVIEW" ? "初审" : "终审"}时限已过半。`,
      );
      await tx.slaRound.update({
        where: { id: round.id },
        data: { reminderSentAt: new Date() },
      });
    });
  }

  private async handleSlaOverdue(slaRoundId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const round = await tx.slaRound.findUnique({
        where: { id: slaRoundId },
        include: { opportunity: true },
      });
      if (
        !round ||
        round.status !== "ACTIVE" ||
        round.overdueMarkedAt ||
        round.deadlineAt > new Date()
      )
        return;
      await this.notifyDistrictManagers(
        tx,
        round.opportunity.districtId,
        round.opportunityId,
        "SLA_OVERDUE",
        "审批已超时",
        `${round.opportunity.serialNumber} 已超过${round.kind === "FIRST_REVIEW" ? "24" : "48"}小时审批时限，请尽快处理。`,
      );
      await tx.notification.create({
        data: {
          recipientUserId: round.opportunity.reporterId,
          opportunityId: round.opportunityId,
          type: "SLA_OVERDUE_VISIBLE",
          title: "商机审批已超时",
          body: `${round.opportunity.serialNumber} 的当前审批节点已超时，仍可继续处理。`,
        },
      });
      await tx.slaRound.update({
        where: { id: round.id },
        data: { overdueMarkedAt: new Date() },
      });
    });
  }

  private async notifyDistrictManagers(
    tx: Prisma.TransactionClient,
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
    if (!managers.length) return;
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

  private async maintenance(): Promise<void> {
    await this.audio.deleteExpired();
    await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    await this.prisma.reauthToken.deleteMany({
      where: { expiresAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
  }
}
