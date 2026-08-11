import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import argon2 from "argon2";
import { RoleCode } from "../../generated/prisma/enums";
import { CryptoService } from "../../common/crypto.service";
import { notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";
import {
  CreateRoleGrantDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
  UpsertRoutingDto,
} from "./admin.dto";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async listUsers(page = 1, pageSize = 20) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        include: {
          grants: {
            include: { district: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.user.count(),
    ]);
    return {
      items: users.map((user) => ({
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
      })),
      page: safePage,
      pageSize: safePageSize,
      total,
    };
  }

  async createUser(dto: CreateUserDto) {
    const phone = dto.phone.trim();
    const phoneBlindIndex = this.crypto.blindIndex(phone);
    if (await this.prisma.user.findUnique({ where: { phoneBlindIndex } })) {
      throw new ConflictException({
        message: "该手机号已存在",
        errorCode: "PHONE_EXISTS",
      });
    }
    const encrypted = this.crypto.encrypt(phone);
    const passwordHash = await argon2.hash(dto.initialPassword, {
      type: argon2.argon2id,
    });
    const user = await this.prisma.user.create({
      data: {
        phoneCiphertext: encrypted.ciphertext,
        phoneIv: encrypted.iv,
        phoneTag: encrypted.tag,
        phoneBlindIndex,
        displayName: dto.displayName.trim(),
        credential: { create: { passwordHash } },
      },
    });
    return {
      id: user.id,
      phone,
      displayName: user.displayName,
      active: true,
      mustChangePassword: true,
      grants: [],
    };
  }

  async updateUser(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("账号不存在");
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
      return {
        id: updated.id,
        displayName: updated.displayName,
        active: updated.active,
      };
    });
  }

  async resetPassword(userId: string, dto: ResetPasswordDto) {
    if (!(await this.prisma.user.findUnique({ where: { id: userId } })))
      throw notFound("账号不存在");
    const passwordHash = await argon2.hash(dto.initialPassword, {
      type: argon2.argon2id,
    });
    await this.prisma.$transaction([
      this.prisma.passwordCredential.update({
        where: { userId },
        data: { passwordHash, changedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mustChangePassword: true },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { reset: true };
  }

  async createGrant(userId: string, dto: CreateRoleGrantDto) {
    const districtRoles: RoleCode[] = [
      RoleCode.DISTRICT_MANAGER,
      RoleCode.PERSONAL_HANDLER,
      RoleCode.ORGANIZATION_HANDLER,
    ];
    const requiresDistrict = districtRoles.includes(dto.role);
    if (requiresDistrict !== Boolean(dto.districtId)) {
      throw new BadRequestException({
        message: requiresDistrict ? "该角色必须指定区县" : "该角色不能指定区县",
        errorCode: "INVALID_GRANT_SCOPE",
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.active) throw notFound("有效账号不存在");
    if (
      dto.districtId &&
      !(await this.prisma.district.findUnique({
        where: { id: dto.districtId },
      }))
    ) {
      throw notFound("区县不存在");
    }
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
    return this.prisma.roleGrant.create({
      data: { userId, role: dto.role, districtId: dto.districtId ?? null },
    });
  }

  async deactivateGrant(grantId: string) {
    const grant = await this.prisma.roleGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw notFound("角色授权不存在");
    const referenced = await this.prisma.districtRouting.count({
      where: {
        OR: [
          { managerGrantId: grantId },
          { personalHandlerGrantId: grantId },
          { organizationHandlerGrantId: grantId },
        ],
      },
    });
    if (referenced) {
      throw new ConflictException({
        message: "该授权仍被区县路由使用，请先调整路由",
        errorCode: "GRANT_IN_USE",
      });
    }
    await this.prisma.roleGrant.update({
      where: { id: grantId },
      data: { active: false },
    });
    return { deactivated: true };
  }

  async listDistricts(includeDisabled = true) {
    return this.prisma.district.findMany({
      where: includeDisabled ? {} : { enabled: true },
      select: { id: true, code: true, name: true, enabled: true },
      orderBy: { code: "asc" },
    });
  }

  async listHandlers(
    districtId: string,
    customerType: "PERSONAL" | "ORGANIZATION",
  ) {
    const role: RoleCode =
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

  async updateDistrict(districtId: string, enabled: boolean) {
    if (!(await this.prisma.district.findUnique({ where: { id: districtId } })))
      throw notFound("区县不存在");
    if (!enabled) {
      const openCount = await this.prisma.opportunity.count({
        where: {
          districtId,
          state: { notIn: ["CLOSED_SUCCESS", "CLOSED_FAILURE"] },
        },
      });
      if (openCount) {
        throw new ConflictException({
          message: "该区县仍有未办结商机，不能停用",
          errorCode: "DISTRICT_HAS_OPEN_ITEMS",
        });
      }
    }
    return this.prisma.district.update({
      where: { id: districtId },
      data: { enabled },
    });
  }

  async listRouting() {
    return this.prisma.districtRouting
      .findMany({
        include: {
          district: true,
          manager: { include: { user: true } },
          personalHandler: { include: { user: true } },
          organizationHandler: { include: { user: true } },
        },
        orderBy: { district: { code: "asc" } },
      })
      .then((routes) =>
        routes.map((route) => ({
          districtId: route.districtId,
          districtName: route.district.name,
          manager: this.grantView(route.manager),
          personalHandler: this.grantView(route.personalHandler),
          organizationHandler: this.grantView(route.organizationHandler),
        })),
      );
  }

  async upsertRouting(districtId: string, dto: UpsertRoutingDto) {
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
    });
    if (!district?.enabled) throw notFound("有效区县不存在");
    const grants = await this.prisma.roleGrant.findMany({
      where: {
        id: {
          in: [
            dto.managerGrantId,
            dto.personalHandlerGrantId,
            dto.organizationHandlerGrantId,
          ],
        },
      },
    });
    const expected = new Map<string, RoleCode>([
      [dto.managerGrantId, RoleCode.DISTRICT_MANAGER],
      [dto.personalHandlerGrantId, RoleCode.PERSONAL_HANDLER],
      [dto.organizationHandlerGrantId, RoleCode.ORGANIZATION_HANDLER],
    ]);
    for (const [id, role] of expected) {
      const grant = grants.find((item) => item.id === id);
      if (
        !grant?.active ||
        grant.role !== role ||
        grant.districtId !== districtId
      ) {
        throw new BadRequestException({
          message: "路由角色必须有效、角色匹配且属于同一区县",
          errorCode: "INVALID_ROUTING_GRANT",
        });
      }
    }
    return this.prisma.districtRouting.upsert({
      where: { districtId },
      create: { districtId, ...dto },
      update: dto,
    });
  }

  private grantView(grant: {
    id: string;
    role: RoleCode;
    user: { displayName: string };
  }) {
    return { id: grant.id, role: grant.role, userName: grant.user.displayName };
  }
}
