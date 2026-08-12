import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import type { Response } from "express";
import type { AuthIdentity } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import { forbidden, notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { displaySpecificNeeds } from "../opportunities/specific-needs";
import {
  SuccessExportDto,
  SuccessLibraryQueryDto,
  WorkflowExportDto,
} from "./municipal.dto";

const MAX_EXPORT_ROWS = 50_000;

@Injectable()
export class MunicipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async listSuccesses(identity: AuthIdentity, query: SuccessLibraryQueryDto) {
    this.assertMunicipal(identity);
    const where = this.successWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: { district: true, result: true },
        orderBy: { closedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        serialNumber: item.serialNumber,
        successOpportunityName: this.decryptSuccessName(item.result),
        district: {
          id: item.district.id,
          code: item.district.code,
          name: item.district.name,
        },
        customerType: item.customerType,
        attitude: item.attitude,
        customerContact: this.crypto.decrypt({
          ciphertext: item.customerContactCiphertext,
          iv: item.customerContactIv,
          tag: item.customerContactTag,
        }),
        closedAt: item.closedAt?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getSuccessDetail(identity: AuthIdentity, opportunityId: string) {
    this.assertMunicipal(identity);
    const item = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { state: true },
    });
    if (!item) throw notFound("商机不存在");
    if (item.state !== "CLOSED_SUCCESS")
      throw forbidden("市公司仅可查看成功商机库中的正文");
    const [detail, timeline] = await Promise.all([
      this.opportunities.getDetail(identity, opportunityId),
      this.opportunities.timeline(identity, opportunityId),
    ]);
    await this.prisma.accessAudit.create({
      data: {
        userId: identity.id,
        opportunityId,
        action: "MUNICIPAL_SUCCESS_DETAIL_VIEW",
        metadata: { grantId: identity.activeGrant!.id },
      },
    });
    return { ...detail, timeline };
  }

  async exportWorkflow(
    identity: AuthIdentity,
    token: string | undefined,
    dto: WorkflowExportDto,
    response: Response,
  ): Promise<void> {
    this.assertMunicipal(identity);
    await this.consumeReauth(identity.id, token);
    const opportunityWhere: Prisma.OpportunityWhereInput = {
      ...(dto.districtId ? { districtId: dto.districtId } : {}),
      ...(dto.state ? { state: dto.state } : {}),
      ...(dto.submittedFrom || dto.submittedTo
        ? {
            submittedAt: {
              ...(dto.submittedFrom
                ? { gte: new Date(dto.submittedFrom) }
                : {}),
              ...(dto.submittedTo ? { lte: new Date(dto.submittedTo) } : {}),
            },
          }
        : {}),
    };
    const eventWhere: Prisma.WorkflowEventWhereInput = {
      opportunity: { is: opportunityWhere },
    };
    const count = await this.prisma.workflowEvent.count({ where: eventWhere });
    if (count > MAX_EXPORT_ROWS)
      throw new BadRequestException({
        message: `导出结果 ${count} 行，超过 50000 行上限，请缩小筛选范围`,
        errorCode: "EXPORT_TOO_LARGE",
      });
    const audit = await this.prisma.exportAudit.create({
      data: {
        userId: identity.id,
        exportType: "WORKFLOW_NODES",
        filters: { ...dto },
        rowCount: 0,
        startedAt: new Date(),
      },
    });
    this.prepareDownload(response, "workflow-node-details");
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: response,
      useStyles: true,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet("流转节点明细", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "商机编号", key: "serialNumber", width: 24 },
      { header: "区县", key: "district", width: 14 },
      { header: "客户类型", key: "customerType", width: 12 },
      { header: "客户态度", key: "attitude", width: 12 },
      { header: "上报人电话", key: "reporterPhone", width: 18 },
      { header: "客户联系方式", key: "customerContact", width: 28 },
      { header: "具体需求", key: "specificNeed", width: 48 },
      { header: "当前状态", key: "currentState", width: 24 },
      { header: "节点事件", key: "eventType", width: 24 },
      { header: "流转前状态", key: "fromState", width: 24 },
      { header: "流转后状态", key: "toState", width: 24 },
      { header: "操作人", key: "actor", width: 16 },
      { header: "操作角色", key: "actorRole", width: 24 },
      { header: "关键承接人", key: "keyPerson", width: 18 },
      { header: "节点说明", key: "note", width: 40 },
      { header: "节点时间", key: "occurredAt", width: 22 },
      { header: "成功商机名称", key: "successName", width: 36 },
    ];
    sheet.getRow(1).font = { bold: true };
    let cursor: string | undefined;
    let written = 0;
    try {
      while (written < count) {
        const events = await this.prisma.workflowEvent.findMany({
          where: { ...eventWhere, ...(cursor ? { id: { gt: cursor } } : {}) },
          include: {
            actor: true,
            opportunity: { include: { district: true, result: true } },
          },
          orderBy: { id: "asc" },
          take: 500,
        });
        if (!events.length) break;
        for (const event of events) {
          const item = event.opportunity;
          sheet
            .addRow({
              serialNumber: this.safeCell(item.serialNumber),
              district: this.safeCell(item.district.name),
              customerType:
                item.customerType === "PERSONAL" ? "个人客户" : "组织客户",
              attitude: this.attitudeLabel(item.attitude),
              reporterPhone: this.safeCell(
                this.crypto.decrypt({
                  ciphertext: item.reporterPhoneCiphertext,
                  iv: item.reporterPhoneIv,
                  tag: item.reporterPhoneTag,
                }),
              ),
              customerContact: this.safeCell(
                this.crypto.decrypt({
                  ciphertext: item.customerContactCiphertext,
                  iv: item.customerContactIv,
                  tag: item.customerContactTag,
                }),
              ),
              specificNeed: this.safeCell(
                displaySpecificNeeds(
                  this.crypto.decrypt({
                    ciphertext: item.specificNeedCiphertext,
                    iv: item.specificNeedIv,
                    tag: item.specificNeedTag,
                  }),
                ),
              ),
              currentState: item.state,
              eventType: event.eventType,
              fromState: event.fromState ?? "",
              toState: event.toState,
              actor: this.safeCell(event.actor?.displayName ?? "系统"),
              actorRole: event.actorRole ?? "SYSTEM",
              keyPerson: this.safeCell(
                this.workflowKeyPersonName(event.metadata) ?? "",
              ),
              note: this.safeCell(
                this.decryptOptional(
                  event.noteCiphertext,
                  event.noteIv,
                  event.noteTag,
                ) ?? "",
              ),
              occurredAt: this.shanghaiTime(event.occurredAt),
              successName: this.safeCell(
                this.decryptSuccessName(item.result) ?? "",
              ),
            })
            .commit();
          cursor = event.id;
          written += 1;
        }
      }
      sheet.commit();
      await workbook.commit();
      await this.prisma.exportAudit.update({
        where: { id: audit.id },
        data: { rowCount: written, completedAt: new Date(), success: true },
      });
    } catch (error) {
      await this.prisma.exportAudit.update({
        where: { id: audit.id },
        data: {
          rowCount: written,
          completedAt: new Date(),
          success: false,
          errorCode: "STREAM_FAILED",
        },
      });
      throw error;
    }
  }

  async exportSuccesses(
    identity: AuthIdentity,
    token: string | undefined,
    dto: SuccessExportDto,
    response: Response,
  ): Promise<void> {
    this.assertMunicipal(identity);
    await this.consumeReauth(identity.id, token);
    const where = this.successWhere(dto);
    const count = await this.prisma.opportunity.count({ where });
    if (count > MAX_EXPORT_ROWS)
      throw new BadRequestException({
        message: `导出结果 ${count} 行，超过 50000 行上限，请缩小筛选范围`,
        errorCode: "EXPORT_TOO_LARGE",
      });
    const audit = await this.prisma.exportAudit.create({
      data: {
        userId: identity.id,
        exportType: "SUCCESS_LIBRARY",
        filters: { ...dto },
        rowCount: 0,
        startedAt: new Date(),
      },
    });
    this.prepareDownload(response, "successful-opportunities");
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: response,
      useStyles: true,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet("成功商机", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "商机编号", key: "serialNumber", width: 24 },
      { header: "成功商机名称", key: "successName", width: 40 },
      { header: "区县", key: "district", width: 14 },
      { header: "客户类型", key: "customerType", width: 12 },
      { header: "客户态度", key: "attitude", width: 12 },
      { header: "上报人电话", key: "reporterPhone", width: 18 },
      { header: "客户联系方式", key: "customerContact", width: 28 },
      { header: "具体需求", key: "specificNeed", width: 48 },
      { header: "办结时间", key: "closedAt", width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };
    let cursor: string | undefined;
    let written = 0;
    try {
      while (written < count) {
        const rows = await this.prisma.opportunity.findMany({
          where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
          include: { district: true, result: true },
          orderBy: { id: "asc" },
          take: 500,
        });
        if (!rows.length) break;
        for (const item of rows) {
          sheet
            .addRow({
              serialNumber: this.safeCell(item.serialNumber),
              successName: this.safeCell(
                this.decryptSuccessName(item.result) ?? "",
              ),
              district: this.safeCell(item.district.name),
              customerType:
                item.customerType === "PERSONAL" ? "个人客户" : "组织客户",
              attitude: this.attitudeLabel(item.attitude),
              reporterPhone: this.safeCell(
                this.crypto.decrypt({
                  ciphertext: item.reporterPhoneCiphertext,
                  iv: item.reporterPhoneIv,
                  tag: item.reporterPhoneTag,
                }),
              ),
              customerContact: this.safeCell(
                this.crypto.decrypt({
                  ciphertext: item.customerContactCiphertext,
                  iv: item.customerContactIv,
                  tag: item.customerContactTag,
                }),
              ),
              specificNeed: this.safeCell(
                displaySpecificNeeds(
                  this.crypto.decrypt({
                    ciphertext: item.specificNeedCiphertext,
                    iv: item.specificNeedIv,
                    tag: item.specificNeedTag,
                  }),
                ),
              ),
              closedAt: item.closedAt ? this.shanghaiTime(item.closedAt) : "",
            })
            .commit();
          cursor = item.id;
          written += 1;
        }
      }
      sheet.commit();
      await workbook.commit();
      await this.prisma.exportAudit.update({
        where: { id: audit.id },
        data: { rowCount: written, completedAt: new Date(), success: true },
      });
    } catch (error) {
      await this.prisma.exportAudit.update({
        where: { id: audit.id },
        data: {
          rowCount: written,
          completedAt: new Date(),
          success: false,
          errorCode: "STREAM_FAILED",
        },
      });
      throw error;
    }
  }

  private successWhere(
    query: SuccessLibraryQueryDto,
  ): Prisma.OpportunityWhereInput {
    const tokens = query.successOpportunityName
      ? this.crypto.searchTokens(query.successOpportunityName)
      : [];
    return {
      state: "CLOSED_SUCCESS",
      ...(query.districtId ? { districtId: query.districtId } : {}),
      ...(query.customerType ? { customerType: query.customerType } : {}),
      ...(query.attitude ? { attitude: query.attitude } : {}),
      ...(query.customerContact
        ? {
            customerContactBlindIndex: this.crypto.blindIndex(
              query.customerContact,
            ),
          }
        : {}),
      ...(query.closedFrom || query.closedTo
        ? {
            closedAt: {
              ...(query.closedFrom ? { gte: new Date(query.closedFrom) } : {}),
              ...(query.closedTo ? { lte: new Date(query.closedTo) } : {}),
            },
          }
        : {}),
      result: {
        is: {
          kind: "SUCCESS",
          ...(tokens.length
            ? { successNameSearchTokens: { hasEvery: tokens } }
            : {}),
        },
      },
    };
  }

  private async consumeReauth(userId: string, token?: string): Promise<void> {
    if (!token)
      throw new UnauthorizedException({
        message: "导出前必须重新验证密码",
        errorCode: "REAUTH_REQUIRED",
      });
    const tokenHash = this.crypto.hashOpaqueToken(token);
    const result = await this.prisma.reauthToken.updateMany({
      where: { userId, tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (result.count !== 1)
      throw new UnauthorizedException({
        message: "导出授权无效、已使用或已过期",
        errorCode: "REAUTH_INVALID",
      });
  }

  private assertMunicipal(identity: AuthIdentity): void {
    if (
      !identity.activeGrant ||
      !["MUNICIPAL", "SENIOR_MUNICIPAL_ADMIN"].includes(
        identity.activeGrant.role,
      )
    )
      throw forbidden("仅市公司角色或高级市公司管理员可访问该模块");
  }

  private decryptSuccessName(
    result: {
      successNameCiphertext: string | null;
      successNameIv: string | null;
      successNameTag: string | null;
    } | null,
  ): string | null {
    return result?.successNameCiphertext &&
      result.successNameIv &&
      result.successNameTag
      ? this.crypto.decrypt({
          ciphertext: result.successNameCiphertext,
          iv: result.successNameIv,
          tag: result.successNameTag,
        })
      : null;
  }

  private workflowKeyPersonName(
    metadata: Prisma.JsonValue | null,
  ): string | null {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== "object")
      return null;
    const value = metadata.keyPersonName;
    return typeof value === "string" ? value : null;
  }

  private decryptOptional(
    ciphertext: string | null,
    iv: string | null,
    tag: string | null,
  ): string | null {
    return ciphertext && iv && tag
      ? this.crypto.decrypt({ ciphertext, iv, tag })
      : null;
  }

  private safeCell(value: string): string {
    return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  }

  private attitudeLabel(value: string): string {
    return (
      (
        {
          URGENT: "紧急",
          IMPORTANT: "重要",
          GENERAL: "一般",
          POTENTIAL: "潜在",
        } as Record<string, string>
      )[value] ?? value
    );
  }

  private shanghaiTime(date: Date): string {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false,
    }).format(date);
  }

  private prepareDownload(response: Response, prefix: string): void {
    response.status(200);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${prefix}-${Date.now()}.xlsx"`,
    );
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
  }
}
