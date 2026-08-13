import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import argon2 from "argon2";
import type { AuthIdentity } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import { forbidden, notFound } from "../../common/http-error";
import { initialPasswordFromPhone } from "../../common/initial-password";
import { PrismaService } from "../../common/prisma.service";
import { Prisma, RoleCode } from "../../generated/prisma/client";
import {
  CreateRoleGrantDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./admin.dto";
import { AdministrationPolicyService } from "./admin-policy.service";

type LoadedUser = Prisma.UserGetPayload<{ include: { grants: true } }>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly policy: AdministrationPolicyService,
  ) {}

  capabilities(identity: AuthIdentity) {
    return this.policy.capabilities(identity);
  }

  async listUsers(identity: AuthIdentity, query: UserListQueryDto) {
    this.policy.assertCanUseRoleFilter(identity, query.role);
    const capabilities = this.policy.capabilities(identity);
    if (
      query.districtId &&
      capabilities.districtId &&
      query.districtId !== capabilities.districtId
    )
      throw forbidden();

    const search = query.search?.normalize("NFKC").trim();
    const filters: Prisma.UserWhereInput[] = [
      this.policy.userScopeWhere(identity),
    ];
    if (query.active !== undefined) filters.push({ active: query.active });
    if (search) {
      const searchOptions: Prisma.UserWhereInput[] = [
        { displayName: { contains: search, mode: "insensitive" } },
      ];
      if (/^1[3-9]\d{9}$/.test(search))
        searchOptions.push({ phoneBlindIndex: this.crypto.blindIndex(search) });
      filters.push({ OR: searchOptions });
    }
    if (query.role || query.districtId) {
      filters.push({
        grants: {
          some: {
            active: true,
            ...(query.role ? { role: query.role } : {}),
            ...(query.districtId ? { districtId: query.districtId } : {}),
          },
        },
      });
    }
    const where: Prisma.UserWhereInput = { AND: filters };
    const visibleGrantWhere = this.policy.visibleGrantWhere(identity);
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: {
          grants: {
            where: visibleGrantWhere,
            include: { district: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: users.map((user) => this.userView(user)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async createUser(identity: AuthIdentity, dto: CreateUserDto) {
    const grants = this.distinctGrants(dto.grants);
    this.policy.assertCanCreateUser(identity, grants);
    await this.assertEnabledDistricts(grants);

    const phone = dto.phone.trim();
    const phoneBlindIndex = this.crypto.blindIndex(phone);
    if (await this.prisma.user.findUnique({ where: { phoneBlindIndex } }))
      throw new ConflictException({
        message: "该手机号已存在",
        errorCode: "PHONE_EXISTS",
      });

    const encrypted = this.crypto.encrypt(phone);
    const passwordHash = await argon2.hash(initialPasswordFromPhone(phone), {
      type: argon2.argon2id,
    });
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phoneCiphertext: encrypted.ciphertext,
          phoneIv: encrypted.iv,
          phoneTag: encrypted.tag,
          phoneBlindIndex,
          displayName: dto.displayName.trim(),
          credential: { create: { passwordHash } },
          grants: {
            create: grants.map((grant) => ({
              role: grant.role,
              districtId: grant.districtId ?? null,
            })),
          },
        },
      });
      await this.policy.audit(
        identity,
        "ADMIN_USER_CREATED",
        {
          targetUserId: created.id,
          grants: grants.map((grant) => ({
            role: grant.role,
            districtId: grant.districtId ?? null,
          })),
        },
        tx,
      );
      return created;
    });
    return {
      id: user.id,
      phone,
      displayName: user.displayName,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async updateUser(identity: AuthIdentity, userId: string, dto: UpdateUserDto) {
    const target = await this.loadUser(userId);
    this.policy.assertCanManageGlobalUser(identity, target);
    if (dto.active === false) await this.assertCanDeactivateUser(target!);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(dto.displayName !== undefined
            ? { displayName: dto.displayName.trim() }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      if (dto.active === false) {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.roleGrant.updateMany({
          where: { userId, active: true },
          data: { active: false },
        });
      }
      await this.policy.audit(
        identity,
        "ADMIN_USER_UPDATED",
        {
          targetUserId: userId,
          displayNameChanged: dto.displayName !== undefined,
          active: dto.active ?? null,
        },
        tx,
      );
      return {
        id: updated.id,
        displayName: updated.displayName,
        active: updated.active,
      };
    });
  }

  async resetPassword(
    identity: AuthIdentity,
    userId: string,
    _dto: ResetPasswordDto,
  ) {
    const target = await this.loadUser(userId);
    this.policy.assertCanManageGlobalUser(identity, target);
    const phone = this.crypto.decrypt({
      ciphertext: target.phoneCiphertext,
      iv: target.phoneIv,
      tag: target.phoneTag,
    });
    const passwordHash = await argon2.hash(initialPasswordFromPhone(phone), {
      type: argon2.argon2id,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordCredential.upsert({
        where: { userId },
        create: { userId, passwordHash },
        update: { passwordHash, changedAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: { mustChangePassword: true },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.policy.audit(
        identity,
        "ADMIN_PASSWORD_RESET",
        { targetUserId: userId },
        tx,
      );
    });
    return { reset: true };
  }

  async createGrant(
    identity: AuthIdentity,
    userId: string,
    dto: CreateRoleGrantDto,
  ) {
    const target = await this.loadUser(userId);
    this.policy.assertCanSeeUser(identity, target);
    this.policy.assertCanManageGrant(
      identity,
      dto.role,
      dto.districtId ?? null,
    );
    await this.assertEnabledDistricts([dto]);
    if (!target!.active) throw notFound("有效账号不存在");

    const duplicate = await this.prisma.roleGrant.findFirst({
      where: {
        userId,
        role: dto.role,
        districtId: dto.districtId ?? null,
        active: true,
      },
    });
    if (duplicate)
      throw new ConflictException({
        message: "相同角色授权已存在",
        errorCode: "GRANT_EXISTS",
      });

    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.roleGrant.create({
        data: {
          userId,
          role: dto.role,
          districtId: dto.districtId ?? null,
        },
      });
      await this.policy.audit(
        identity,
        "ADMIN_GRANT_CREATED",
        {
          targetUserId: userId,
          targetGrantId: grant.id,
          role: grant.role,
          districtId: grant.districtId,
        },
        tx,
      );
      return grant;
    });
  }

  async deactivateGrant(identity: AuthIdentity, grantId: string) {
    const grant = await this.prisma.roleGrant.findUnique({
      where: { id: grantId },
      include: { user: { include: { grants: true } } },
    });
    if (!grant) throw notFound("角色授权不存在");
    this.policy.assertCanSeeUser(identity, grant.user);
    this.policy.assertCanManageGrant(identity, grant.role, grant.districtId);
    await this.assertGrantCanDeactivate(this.prisma, grant);

    await this.prisma.$transaction(async (tx) => {
      await tx.roleGrant.update({
        where: { id: grantId },
        data: { active: false },
      });
      await this.policy.audit(
        identity,
        "ADMIN_GRANT_DEACTIVATED",
        {
          targetUserId: grant.userId,
          targetGrantId: grant.id,
          role: grant.role,
          districtId: grant.districtId,
        },
        tx,
      );
    });
    return { deactivated: true };
  }

  async listDistricts(identity: AuthIdentity) {
    const rows = await this.prisma.district.findMany({
      where: {
        AND: [
          this.policy.districtScopeWhere(identity),
          { sortOrder: { lt: 900 } },
        ],
      },
      include: {
        grants: {
          where: { active: true, user: { active: true } },
          select: { role: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    return rows.map((district) => ({
      id: district.id,
      code: district.code,
      name: district.name,
      enabled: district.enabled,
      sortOrder: district.sortOrder,
      coverage: {
        fieldReporters: district.grants.filter(
          (grant) => grant.role === RoleCode.FIELD_REPORTER,
        ).length,
        managers: district.grants.filter(
          (grant) => grant.role === RoleCode.DISTRICT_MANAGER,
        ).length,
        personalHandlers: district.grants.filter(
          (grant) => grant.role === RoleCode.PERSONAL_HANDLER,
        ).length,
        organizationHandlers: district.grants.filter(
          (grant) => grant.role === RoleCode.ORGANIZATION_HANDLER,
        ).length,
      },
    }));
  }

  listReferenceDistricts() {
    return this.prisma.district.findMany({
      where: { enabled: true, sortOrder: { lt: 900 } },
      select: {
        id: true,
        code: true,
        name: true,
        enabled: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
  }

  async listHandlers(
    districtId: string,
    customerType: "PERSONAL" | "ORGANIZATION",
  ) {
    const role =
      customerType === "PERSONAL"
        ? RoleCode.PERSONAL_HANDLER
        : RoleCode.ORGANIZATION_HANDLER;
    const grants = await this.prisma.roleGrant.findMany({
      where: { districtId, role, active: true, user: { active: true } },
      include: { user: true },
      orderBy: { user: { displayName: "asc" } },
    });
    return grants.map((grant) => ({
      id: grant.id,
      role: grant.role,
      userName: grant.user.displayName,
    }));
  }

  async updateDistrict(
    identity: AuthIdentity,
    districtId: string,
    enabled: boolean,
  ) {
    this.policy.assertSystem(identity);
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
    });
    if (!district || district.sortOrder >= 900) throw notFound("区县不存在");
    if (!enabled) {
      const openCount = await this.prisma.opportunity.count({
        where: {
          districtId,
          state: { notIn: ["CLOSED_SUCCESS", "CLOSED_FAILURE"] },
        },
      });
      if (openCount)
        throw new ConflictException({
          message: "该区县仍有未办结商机，不能在界面停用",
          errorCode: "DISTRICT_HAS_OPEN_ITEMS",
        });
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.district.update({
        where: { id: districtId },
        data: { enabled },
      });
      await this.policy.audit(
        identity,
        "ADMIN_DISTRICT_UPDATED",
        { districtId, enabled },
        tx,
      );
      return updated;
    });
  }

  private async loadUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { grants: true },
    });
  }

  private distinctGrants(grants: CreateRoleGrantDto[]) {
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
    const districtIds = [
      ...new Set(grants.map((grant) => grant.districtId).filter(Boolean)),
    ] as string[];
    if (!districtIds.length) return;
    const count = await this.prisma.district.count({
      where: { id: { in: districtIds }, enabled: true },
    });
    if (count !== districtIds.length) throw notFound("有效区县不存在");
  }

  private async assertCanDeactivateUser(user: LoadedUser): Promise<void> {
    for (const grant of user.grants.filter((item) => item.active))
      await this.assertGrantCanDeactivate(this.prisma, grant);
  }

  private async assertGrantCanDeactivate(
    db: Prisma.TransactionClient | PrismaService,
    grant: {
      id: string;
      role: RoleCode;
      districtId: string | null;
      active: boolean;
    },
  ): Promise<void> {
    if (!grant.active) return;
    if (
      (<RoleCode[]>[
        RoleCode.PERSONAL_HANDLER,
        RoleCode.ORGANIZATION_HANDLER,
      ]).includes(grant.role)
    ) {
      const activeAssignments = await db.assignment.count({
        where: {
          handlerGrantId: grant.id,
          active: true,
          opportunity: {
            state: { notIn: ["CLOSED_SUCCESS", "CLOSED_FAILURE"] },
          },
        },
      });
      if (activeAssignments)
        throw new ConflictException({
          message: "该承接授权仍有活动商机，请先完成改派",
          errorCode: "GRANT_HAS_ACTIVE_ASSIGNMENTS",
        });
    }
    if (grant.role === RoleCode.DISTRICT_MANAGER && grant.districtId) {
      const [otherManagers, openItems] = await Promise.all([
        db.roleGrant.count({
          where: {
            id: { not: grant.id },
            districtId: grant.districtId,
            role: RoleCode.DISTRICT_MANAGER,
            active: true,
            user: { active: true },
          },
        }),
        db.opportunity.count({
          where: {
            districtId: grant.districtId,
            state: { notIn: ["CLOSED_SUCCESS", "CLOSED_FAILURE"] },
          },
        }),
      ]);
      if (!otherManagers && openItems)
        throw new ConflictException({
          message: "该区县仍有未办结商机，不能撤销最后一名区县经理",
          errorCode: "LAST_DISTRICT_MANAGER_REQUIRED",
        });
    }
    if (grant.role === RoleCode.SYSTEM_ADMIN) {
      const remaining = await db.roleGrant.count({
        where: {
          id: { not: grant.id },
          role: RoleCode.SYSTEM_ADMIN,
          active: true,
          user: { active: true },
        },
      });
      if (!remaining)
        throw new ConflictException({
          message: "不能撤销最后一个系统管理员",
          errorCode: "LAST_SYSTEM_ADMIN_REQUIRED",
        });
    }
  }

  private userView(user: {
    id: string;
    phoneCiphertext: string;
    phoneIv: string;
    phoneTag: string;
    displayName: string;
    active: boolean;
    mustChangePassword: boolean;
    createdAt: Date;
    grants: Array<{
      id: string;
      role: RoleCode;
      active: boolean;
      districtId: string | null;
      district: { name: string } | null;
    }>;
  }) {
    return {
      id: user.id,
      phone: this.crypto.decrypt({
        ciphertext: user.phoneCiphertext,
        iv: user.phoneIv,
        tag: user.phoneTag,
      }),
      displayName: user.displayName,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
      grants: user.grants.map((grant) => ({
        id: grant.id,
        role: grant.role,
        active: grant.active,
        districtId: grant.districtId,
        districtName: grant.district?.name ?? null,
      })),
    };
  }
}
