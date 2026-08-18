import { Injectable } from "@nestjs/common";
import type {
  AdminCapabilities,
  RoleCode as ContractRoleCode,
} from "@oms/contracts";
import type { AuthIdentity } from "../../common/auth.types";
import { forbidden, notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import { Prisma, RoleCode } from "../../generated/prisma/client";

export const DISTRICT_CHILD_ROLES: RoleCode[] = [
  RoleCode.FIELD_REPORTER,
  RoleCode.PERSONAL_HANDLER,
  RoleCode.ORGANIZATION_HANDLER,
];

export const DISTRICT_SCOPED_ROLES: RoleCode[] = [
  RoleCode.FIELD_REPORTER,
  RoleCode.DISTRICT_MANAGER,
  RoleCode.PERSONAL_HANDLER,
  RoleCode.ORGANIZATION_HANDLER,
];

const SENIOR_MANAGED_ROLES: RoleCode[] = [
  RoleCode.FIELD_REPORTER,
  RoleCode.DISTRICT_MANAGER,
  RoleCode.PERSONAL_HANDLER,
  RoleCode.ORGANIZATION_HANDLER,
  RoleCode.MUNICIPAL,
];

const SENIOR_PROTECTED_ROLES: RoleCode[] = [
  RoleCode.SENIOR_MUNICIPAL_ADMIN,
  RoleCode.SYSTEM_ADMIN,
];

const DISTRICT_PROTECTED_ROLES: RoleCode[] = [
  RoleCode.DISTRICT_MANAGER,
  RoleCode.MUNICIPAL,
  RoleCode.SENIOR_MUNICIPAL_ADMIN,
  RoleCode.SYSTEM_ADMIN,
];

type UserWithGrants = {
  id: string;
  grants: Array<{
    role: RoleCode;
    districtId: string | null;
    active: boolean;
  }>;
};

@Injectable()
export class AdministrationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  capabilities(identity: AuthIdentity): AdminCapabilities {
    const grant = this.adminGrant(identity);
    const system = grant.role === RoleCode.SYSTEM_ADMIN;
    const senior = grant.role === RoleCode.SENIOR_MUNICIPAL_ADMIN;
    return {
      activeRole: grant.role as AdminCapabilities["activeRole"],
      districtId: grant.districtId,
      manageableRoles: this.manageableRoles(identity) as ContractRoleCode[],
      canManageGlobalUsers: system || senior,
      canManageDistricts: system,
      canViewPersonnel: system || senior,
      canImportPersonnel: system,
      canBatchProvisionPersonnel: system,
      canManagePersonnelDistrictRules: system,
      canManagePositions: system || senior,
      canManageRetention: system,
      canViewMunicipal: senior,
    };
  }

  manageableRoles(identity: AuthIdentity): RoleCode[] {
    const grant = this.adminGrant(identity);
    if (grant.role === RoleCode.SYSTEM_ADMIN)
      return Object.values(RoleCode) as RoleCode[];
    if (grant.role === RoleCode.SENIOR_MUNICIPAL_ADMIN)
      return [...SENIOR_MANAGED_ROLES];
    return [...DISTRICT_CHILD_ROLES];
  }

  userScopeWhere(identity: AuthIdentity): Prisma.UserWhereInput {
    const grant = this.adminGrant(identity);
    if (grant.role === RoleCode.SYSTEM_ADMIN) return {};
    if (grant.role === RoleCode.SENIOR_MUNICIPAL_ADMIN) {
      return {
        grants: {
          none: { active: true, role: { in: SENIOR_PROTECTED_ROLES } },
        },
      };
    }
    return {
      AND: [
        {
          grants: {
            none: { active: true, role: { in: DISTRICT_PROTECTED_ROLES } },
          },
        },
        {
          OR: [
            {
              grants: {
                some: {
                  active: true,
                  districtId: grant.districtId!,
                  role: { in: DISTRICT_CHILD_ROLES },
                },
              },
            },
            {
              AND: [
                {
                  grants: {
                    some: {
                      districtId: grant.districtId!,
                      role: { in: DISTRICT_CHILD_ROLES },
                    },
                  },
                },
                {
                  grants: {
                    none: {
                      active: true,
                      role: { in: DISTRICT_CHILD_ROLES },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  visibleGrantWhere(identity: AuthIdentity): Prisma.RoleGrantWhereInput {
    const grant = this.adminGrant(identity);
    if (grant.role === RoleCode.SYSTEM_ADMIN) return {};
    if (grant.role === RoleCode.SENIOR_MUNICIPAL_ADMIN)
      return { role: { in: SENIOR_MANAGED_ROLES } };
    return {
      districtId: grant.districtId!,
      role: { in: DISTRICT_CHILD_ROLES },
    };
  }

  districtScopeWhere(identity: AuthIdentity): Prisma.DistrictWhereInput {
    const grant = this.adminGrant(identity);
    return grant.role === RoleCode.DISTRICT_MANAGER
      ? { id: grant.districtId! }
      : {};
  }

  assertCanUseRoleFilter(identity: AuthIdentity, role?: RoleCode): void {
    if (role && !this.manageableRoles(identity).includes(role))
      throw forbidden();
  }

  assertCanCreateUser(
    identity: AuthIdentity,
    grants: Array<{ role: RoleCode; districtId?: string }>,
  ): void {
    if (!grants.length) throw forbidden("创建账号时必须同时配置至少一个角色");
    for (const grant of grants)
      this.assertCanManageGrant(identity, grant.role, grant.districtId ?? null);
  }

  assertCanManageGrant(
    identity: AuthIdentity,
    role: RoleCode,
    districtId: string | null,
  ): void {
    const actor = this.adminGrant(identity);
    const needsDistrict = DISTRICT_SCOPED_ROLES.includes(role);
    if (needsDistrict !== Boolean(districtId))
      throw forbidden(
        needsDistrict ? "该角色必须指定区县" : "该角色不能指定区县",
      );

    if (actor.role === RoleCode.SYSTEM_ADMIN) return;
    if (actor.role === RoleCode.SENIOR_MUNICIPAL_ADMIN) {
      if (!SENIOR_MANAGED_ROLES.includes(role)) throw forbidden();
      return;
    }
    if (!DISTRICT_CHILD_ROLES.includes(role) || districtId !== actor.districtId)
      throw forbidden();
  }

  assertCanSeeUser(
    identity: AuthIdentity,
    user: UserWithGrants | null,
  ): asserts user {
    if (!user || !this.userVisible(identity, user))
      throw notFound("账号不存在");
  }

  assertCanManageGlobalUser(
    identity: AuthIdentity,
    user: UserWithGrants | null,
  ): asserts user {
    this.assertCanSeeUser(identity, user);
    const role = this.adminGrant(identity).role;
    if (
      role !== RoleCode.SYSTEM_ADMIN &&
      role !== RoleCode.SENIOR_MUNICIPAL_ADMIN
    )
      throw forbidden("区县经理只能调整本区县角色授权");
  }

  assertCanManagePersonnel(identity: AuthIdentity): void {
    const role = this.adminGrant(identity).role;
    if (
      role !== RoleCode.SYSTEM_ADMIN &&
      role !== RoleCode.SENIOR_MUNICIPAL_ADMIN
    )
      throw forbidden();
  }

  assertCanImportPersonnel(identity: AuthIdentity): void {
    if (this.adminGrant(identity).role !== RoleCode.SYSTEM_ADMIN)
      throw forbidden("仅系统管理员可上传并同步人员表");
  }

  assertCanBatchProvisionPersonnel(identity: AuthIdentity): void {
    if (this.adminGrant(identity).role !== RoleCode.SYSTEM_ADMIN)
      throw forbidden("仅系统管理员可批量开通一线上报人账号");
  }

  assertCanConfigureTemplate(identity: AuthIdentity, roles: RoleCode[]): void {
    this.assertCanManagePersonnel(identity);
    if (roles.some((role) => SENIOR_PROTECTED_ROLES.includes(role)))
      throw forbidden("高级市公司管理员和系统管理员不能通过职务模板授予");
    for (const role of roles) {
      if (!SENIOR_MANAGED_ROLES.includes(role)) throw forbidden();
    }
  }

  assertSystem(identity: AuthIdentity): void {
    if (this.adminGrant(identity).role !== RoleCode.SYSTEM_ADMIN)
      throw forbidden("仅系统管理员可执行该操作");
  }

  async audit(
    identity: AuthIdentity,
    action: string,
    metadata: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.accessAudit.create({
      data: {
        userId: identity.id,
        action,
        metadata: {
          actorGrantId: identity.activeGrant?.id ?? null,
          ...((metadata as Record<string, unknown>) ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private userVisible(identity: AuthIdentity, user: UserWithGrants): boolean {
    const actor = this.adminGrant(identity);
    const active = user.grants.filter((grant) => grant.active);
    if (actor.role === RoleCode.SYSTEM_ADMIN) return true;
    if (actor.role === RoleCode.SENIOR_MUNICIPAL_ADMIN)
      return !active.some((grant) =>
        SENIOR_PROTECTED_ROLES.includes(grant.role),
      );
    return (
      !active.some((grant) => DISTRICT_PROTECTED_ROLES.includes(grant.role)) &&
      (active.some(
        (grant) =>
          grant.districtId === actor.districtId &&
          DISTRICT_CHILD_ROLES.includes(grant.role),
      ) ||
        (!active.some((grant) => DISTRICT_CHILD_ROLES.includes(grant.role)) &&
          user.grants.some(
            (grant) =>
              grant.districtId === actor.districtId &&
              DISTRICT_CHILD_ROLES.includes(grant.role),
          )))
    );
  }

  private adminGrant(identity: AuthIdentity) {
    const grant = identity.activeGrant;
    if (
      !grant ||
      !(<RoleCode[]>[
        RoleCode.SYSTEM_ADMIN,
        RoleCode.SENIOR_MUNICIPAL_ADMIN,
        RoleCode.DISTRICT_MANAGER,
      ]).includes(grant.role as RoleCode)
    )
      throw forbidden("请选择具备账号管理权限的当前角色");
    return grant as typeof grant & { role: RoleCode };
  }
}
