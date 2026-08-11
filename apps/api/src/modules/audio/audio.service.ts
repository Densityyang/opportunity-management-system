import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseBuffer } from "music-metadata";
import type { AuthIdentity } from "../../common/auth.types";
import { forbidden, notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import { OpportunityAccessService } from "../opportunities/opportunity-access.service";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 30_000;
const SUPPORTED_MIME = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
]);

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly root = resolve(
    process.env.AUDIO_STORAGE_PATH ?? "/data/audio",
  );
  private readonly key = this.readKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OpportunityAccessService,
  ) {}

  async upload(
    identity: AuthIdentity,
    opportunityId: string,
    file?: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException({
        message: "请选择录音文件",
        errorCode: "AUDIO_REQUIRED",
      });
    if (file.size > MAX_AUDIO_BYTES)
      throw new BadRequestException({
        message: "录音文件不能超过 5 MB",
        errorCode: "AUDIO_TOO_LARGE",
      });
    const mimeType = file.mimetype.toLowerCase().split(";")[0]!;
    if (
      !SUPPORTED_MIME.has(mimeType) ||
      !this.validMagic(file.buffer, mimeType)
    ) {
      throw new BadRequestException({
        message: "仅支持浏览器生成的 WebM 或 MP4/M4A 录音",
        errorCode: "UNSUPPORTED_AUDIO",
      });
    }
    const metadata = await parseBuffer(file.buffer, {
      mimeType,
      size: file.size,
    });
    const durationMs = Math.ceil((metadata.format.duration ?? 0) * 1000);
    if (!durationMs || durationMs > MAX_AUDIO_DURATION_MS + 500) {
      throw new BadRequestException({
        message: "录音时长必须在 30 秒以内",
        errorCode: "AUDIO_DURATION_INVALID",
      });
    }
    const item = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: { audio: true },
    });
    if (!item) throw notFound("商机不存在");
    if (
      identity.activeGrant?.role !== "FIELD_REPORTER" ||
      item.reporterId !== identity.id
    )
      throw forbidden();
    if (
      !["PENDING_FIRST_REVIEW", "RETURNED_TO_REPORTER"].includes(item.state)
    ) {
      throw new ConflictException({
        message: "当前状态不能新增或替换录音",
        errorCode: "AUDIO_LOCKED",
      });
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(file.buffer),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const storageKey = `${opportunityId}/${randomUUID()}.bin`;
    const fullPath = this.safePath(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, encrypted, { flag: "wx", mode: 0o600 });

    const saved = await this.prisma.audioRecord
      .upsert({
        where: { opportunityId },
        create: {
          opportunityId,
          storageKey,
          encryptionIv: iv.toString("base64"),
          encryptionTag: tag.toString("base64"),
          mimeType,
          sizeBytes: file.size,
          durationMs,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
        },
        update: {
          storageKey,
          encryptionIv: iv.toString("base64"),
          encryptionTag: tag.toString("base64"),
          mimeType,
          sizeBytes: file.size,
          durationMs,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
          status: "ACTIVE",
          deleteAfter: null,
          deletedAt: null,
        },
      })
      .catch(async (error: unknown) => {
        await this.deletePhysical(storageKey);
        throw error;
      });
    if (item.audio?.storageKey && item.audio.storageKey !== storageKey) {
      try {
        await this.deletePhysical(item.audio.storageKey);
      } catch (error) {
        this.logger.warn(
          `Failed to remove replaced encrypted audio object ${item.audio.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { id: saved.id, mimeType, sizeBytes: file.size, durationMs };
  }

  async playback(
    identity: AuthIdentity,
    opportunityId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    await this.access.loadReadable(identity, opportunityId);
    const audio = await this.prisma.audioRecord.findUnique({
      where: { opportunityId },
    });
    if (!audio || audio.status !== "ACTIVE" || audio.deletedAt)
      throw notFound("录音不存在或已按留存规则删除");
    const encrypted = await readFile(this.safePath(audio.storageKey));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(audio.encryptionIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(audio.encryptionTag, "base64"));
    const buffer = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    await this.prisma.accessAudit.create({
      data: {
        userId: identity.id,
        opportunityId,
        action: "AUDIO_PLAYBACK",
        metadata: {
          grantId: identity.activeGrant?.id ?? null,
          role: identity.activeGrant?.role ?? null,
        },
      },
    });
    return { buffer, mimeType: audio.mimeType };
  }

  async removeByReporter(
    identity: AuthIdentity,
    opportunityId: string,
  ): Promise<{ deleted: true }> {
    const item = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: { audio: true },
    });
    if (!item) throw notFound("商机不存在");
    if (
      identity.activeGrant?.role !== "FIELD_REPORTER" ||
      item.reporterId !== identity.id
    )
      throw forbidden();
    if (
      !["PENDING_FIRST_REVIEW", "RETURNED_TO_REPORTER"].includes(item.state)
    ) {
      throw new ConflictException({
        message: "当前状态不能删除录音",
        errorCode: "AUDIO_LOCKED",
      });
    }
    if (!item.audio || item.audio.status === "DELETED")
      return { deleted: true };
    await this.deletePhysical(item.audio.storageKey);
    await this.prisma.audioRecord.update({
      where: { id: item.audio.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async deleteExpired(): Promise<number> {
    const rows = await this.prisma.audioRecord.findMany({
      where: { status: "ACTIVE", deleteAfter: { lte: new Date() } },
      take: 100,
    });
    let deleted = 0;
    for (const row of rows) {
      await this.deletePhysical(row.storageKey);
      await this.prisma.audioRecord.update({
        where: { id: row.id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      deleted += 1;
    }
    return deleted;
  }

  async purgeForOpportunity(opportunityId: string): Promise<void> {
    const row = await this.prisma.audioRecord.findUnique({
      where: { opportunityId },
    });
    if (!row) return;
    await this.deletePhysical(row.storageKey);
    await this.prisma.audioRecord.update({
      where: { id: row.id },
      data: { status: "DELETED", deletedAt: row.deletedAt ?? new Date() },
    });
  }

  private validMagic(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === "audio/webm")
      return buffer
        .subarray(0, 4)
        .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    return (
      buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp"
    );
  }

  private safePath(storageKey: string): string {
    const candidate = resolve(join(this.root, storageKey));
    if (
      !candidate.startsWith(
        `${this.root}${process.platform === "win32" ? "\\" : "/"}`,
      )
    )
      throw new Error("Unsafe storage key");
    return candidate;
  }

  private async deletePhysical(storageKey: string): Promise<void> {
    await rm(this.safePath(storageKey), { force: true });
  }

  private readKey(): Buffer {
    const value = process.env.AUDIO_ENCRYPTION_KEY_BASE64;
    if (!value) throw new Error("AUDIO_ENCRYPTION_KEY_BASE64 is required");
    const key = Buffer.from(value, "base64");
    if (key.length !== 32)
      throw new Error("AUDIO_ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
    return key;
  }
}
