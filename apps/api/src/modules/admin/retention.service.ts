import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthIdentity } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import { notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import { AudioService } from "../audio/audio.service";
import { CompleteRetentionDto } from "./retention.dto";

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audio: AudioService,
  ) {}

  async list(page = 1, pageSize = 50) {
    const now = new Date();
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where = { status: "PENDING" as const, eligibleAt: { lte: now } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.retentionCandidate.findMany({
        where,
        include: {
          opportunity: {
            select: {
              serialNumber: true,
              state: true,
              closedAt: true,
              district: { select: { name: true } },
            },
          },
        },
        orderBy: { eligibleAt: "asc" },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.retentionCandidate.count({ where }),
    ]);
    return { items, total, page: safePage, pageSize: safeSize };
  }

  async complete(
    identity: AuthIdentity,
    candidateId: string,
    dto: CompleteRetentionDto,
  ) {
    const candidate = await this.prisma.retentionCandidate.findUnique({
      where: { id: candidateId },
      include: { opportunity: true },
    });
    if (!candidate) throw notFound("留存清理候选不存在");
    if (candidate.status !== "PENDING" || candidate.eligibleAt > new Date()) {
      throw new BadRequestException({
        message: "该记录尚未到清理时间或已处理",
        errorCode: "RETENTION_NOT_ELIGIBLE",
      });
    }
    if (
      candidate.opportunity.serialNumber !== dto.confirmationSerialNumber.trim()
    ) {
      throw new BadRequestException({
        message: "商机编号确认不匹配",
        errorCode: "RETENTION_CONFIRMATION_MISMATCH",
      });
    }
    await this.audio.purgeForOpportunity(candidate.opportunityId);
    if (dto.action === "DELETE") {
      await this.prisma.$transaction(async (tx) => {
        await tx.accessAudit.create({
          data: {
            userId: identity.id,
            opportunityId: candidate.opportunityId,
            action: "RETENTION_DELETE",
            metadata: {
              serialNumber: candidate.opportunity.serialNumber,
              candidateId,
            },
          },
        });
        await tx.opportunity.delete({ where: { id: candidate.opportunityId } });
      });
      return { completed: true, action: "DELETE" };
    }

    const placeholder = this.crypto.encrypt("[已按留存规则匿名化]");
    const anonymous = await this.ensureAnonymousUser();
    await this.prisma.$transaction(async (tx) => {
      await tx.opportunity.update({
        where: { id: candidate.opportunityId },
        data: {
          reporterId: anonymous.id,
          reporterPhoneCiphertext: placeholder.ciphertext,
          reporterPhoneIv: placeholder.iv,
          reporterPhoneTag: placeholder.tag,
          customerContactCiphertext: placeholder.ciphertext,
          customerContactIv: placeholder.iv,
          customerContactTag: placeholder.tag,
          customerContactBlindIndex: this.crypto.blindIndex(
            `anonymized:${candidate.opportunityId}`,
          ),
          specificNeedCiphertext: placeholder.ciphertext,
          specificNeedIv: placeholder.iv,
          specificNeedTag: placeholder.tag,
          descriptionCiphertext: null,
          descriptionIv: null,
          descriptionTag: null,
        },
      });
      await tx.opportunityRevision.updateMany({
        where: { opportunityId: candidate.opportunityId },
        data: { submittedById: anonymous.id, snapshot: { anonymized: true } },
      });
      await tx.workflowEvent.updateMany({
        where: { opportunityId: candidate.opportunityId },
        data: {
          actorUserId: null,
          noteCiphertext: null,
          noteIv: null,
          noteTag: null,
        },
      });
      await tx.assignment.updateMany({
        where: { opportunityId: candidate.opportunityId },
        data: { reasonCiphertext: null, reasonIv: null, reasonTag: null },
      });
      await tx.handlingResult.updateMany({
        where: { opportunityId: candidate.opportunityId, kind: "FAILURE" },
        data: {
          failureReasonCiphertext: placeholder.ciphertext,
          failureReasonIv: placeholder.iv,
          failureReasonTag: placeholder.tag,
        },
      });
      await tx.notification.deleteMany({
        where: { opportunityId: candidate.opportunityId },
      });
      await tx.retentionCandidate.update({
        where: { id: candidateId },
        data: {
          status: "COMPLETED",
          suggestedAction: "ANONYMIZE",
          reviewedById: identity.id,
          reviewedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await tx.accessAudit.create({
        data: {
          userId: identity.id,
          opportunityId: candidate.opportunityId,
          action: "RETENTION_ANONYMIZE",
          metadata: {
            serialNumber: candidate.opportunity.serialNumber,
            candidateId,
          },
        },
      });
    });
    return { completed: true, action: "ANONYMIZE" };
  }

  private async ensureAnonymousUser() {
    const phoneBlindIndex = this.crypto.blindIndex("__retention_anonymous__");
    const encrypted = this.crypto.encrypt("[匿名账号]");
    return this.prisma.user.upsert({
      where: { phoneBlindIndex },
      create: {
        phoneCiphertext: encrypted.ciphertext,
        phoneIv: encrypted.iv,
        phoneTag: encrypted.tag,
        phoneBlindIndex,
        displayName: "留存匿名主体",
        active: false,
        mustChangePassword: false,
      },
      update: {},
    });
  }
}
