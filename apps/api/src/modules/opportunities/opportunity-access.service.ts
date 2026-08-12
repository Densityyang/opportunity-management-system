import { Injectable } from "@nestjs/common";
import type { AuthIdentity } from "../../common/auth.types";
import { forbidden, notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";

@Injectable()
export class OpportunityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async loadReadable(identity: AuthIdentity, opportunityId: string) {
    const item = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        district: true,
        result: true,
        audio: true,
        assignments: {
          where: { active: true },
          include: { handlerGrant: true },
        },
        slaRounds: {
          where: { status: "ACTIVE" },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!item) throw notFound("商机不存在");
    const grant = identity.activeGrant;
    if (!grant || grant.role === "SYSTEM_ADMIN")
      throw forbidden("系统管理员默认无权查看商机内容");
    const allowed =
      (grant.role === "FIELD_REPORTER" && item.reporterId === identity.id) ||
      (grant.role === "DISTRICT_MANAGER" &&
        grant.districtId === item.districtId) ||
      (["PERSONAL_HANDLER", "ORGANIZATION_HANDLER"].includes(grant.role) &&
        item.assignments.some(
          (assignment) => assignment.handlerGrantId === grant.id,
        )) ||
      (["MUNICIPAL", "SENIOR_MUNICIPAL_ADMIN"].includes(grant.role) &&
        item.state === "CLOSED_SUCCESS");
    if (!allowed) throw forbidden("当前角色无权查看该商机");
    return item;
  }

  async assertCurrentHandler(identity: AuthIdentity, opportunityId: string) {
    const grant = identity.activeGrant;
    if (
      !grant ||
      !["PERSONAL_HANDLER", "ORGANIZATION_HANDLER"].includes(grant.role)
    )
      throw forbidden();
    const assignment = await this.prisma.assignment.findFirst({
      where: { opportunityId, handlerGrantId: grant.id, active: true },
    });
    if (!assignment) throw forbidden("仅当前承接人可执行该操作");
    return grant;
  }
}
