import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { CurrentUserView } from "@oms/contracts";
import type { AuthIdentity } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import { PrismaService } from "../../common/prisma.service";
import { ChangePasswordDto, LoginDto } from "./auth.dto";

const SESSION_COOKIE = "oms_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async login(
    dto: LoginDto,
    response: Response,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<CurrentUserView> {
    const phone = dto.phone.trim();
    const user = await this.prisma.user.findUnique({
      where: { phoneBlindIndex: this.crypto.blindIndex(phone) },
      include: {
        credential: true,
        grants: { where: { active: true }, include: { district: true } },
      },
    });
    if (
      !user?.active ||
      !user.credential ||
      !(await argon2.verify(user.credential.passwordHash, dto.password))
    ) {
      throw new UnauthorizedException({
        message: "手机号或密码错误",
        errorCode: "INVALID_CREDENTIALS",
      });
    }

    const token = randomBytes(32).toString("base64url");
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: userAgent?.slice(0, 500),
        ipAddress: ipAddress?.slice(0, 64),
      },
    });
    this.setSessionCookie(
      response,
      token,
      new Date(Date.now() + SESSION_TTL_MS),
    );
    return this.toView(user);
  }

  async changePassword(
    identity: AuthIdentity,
    dto: ChangePasswordDto,
  ): Promise<{ changed: true }> {
    if (dto.currentPassword === dto.newPassword) {
      throw new ForbiddenException({
        message: "新密码不能与当前密码相同",
        errorCode: "PASSWORD_REUSED",
      });
    }
    const credential = await this.prisma.passwordCredential.findUnique({
      where: { userId: identity.id },
    });
    if (
      !credential ||
      !(await argon2.verify(credential.passwordHash, dto.currentPassword))
    ) {
      throw new UnauthorizedException({
        message: "当前密码错误",
        errorCode: "INVALID_CREDENTIALS",
      });
    }
    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });
    await this.prisma.$transaction([
      this.prisma.passwordCredential.update({
        where: { userId: identity.id },
        data: { passwordHash, changedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: identity.id },
        data: { mustChangePassword: false },
      }),
      this.prisma.session.updateMany({
        where: {
          userId: identity.id,
          id: { not: identity.sessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { changed: true };
  }

  async createReauthToken(
    identity: AuthIdentity,
    password: string,
  ): Promise<{ token: string; expiresAt: string }> {
    if (!identity.grants.some((grant) => grant.role === "MUNICIPAL")) {
      throw new ForbiddenException({
        message: "仅市公司账号可申请导出授权",
        errorCode: "FORBIDDEN",
      });
    }
    const credential = await this.prisma.passwordCredential.findUnique({
      where: { userId: identity.id },
    });
    if (
      !credential ||
      !(await argon2.verify(credential.passwordHash, password))
    ) {
      throw new UnauthorizedException({
        message: "密码错误",
        errorCode: "INVALID_CREDENTIALS",
      });
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.prisma.reauthToken.create({
      data: {
        userId: identity.id,
        tokenHash: this.crypto.hashOpaqueToken(token),
        expiresAt,
      },
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async logout(
    identity: AuthIdentity,
    response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.prisma.session.update({
      where: { id: identity.sessionId },
      data: { revokedAt: new Date() },
    });
    response.clearCookie(SESSION_COOKIE, { path: "/" });
    return { loggedOut: true };
  }

  toIdentityView(identity: AuthIdentity): CurrentUserView {
    return {
      id: identity.id,
      phone: identity.phone,
      displayName: identity.displayName,
      mustChangePassword: identity.mustChangePassword,
      grants: identity.grants,
    };
  }

  private toView(user: {
    id: string;
    phoneCiphertext: string;
    phoneIv: string;
    phoneTag: string;
    displayName: string;
    mustChangePassword: boolean;
    grants: Array<{
      id: string;
      role: string;
      districtId: string | null;
      district: { name: string } | null;
    }>;
  }): CurrentUserView {
    return {
      id: user.id,
      phone: this.crypto.decrypt({
        ciphertext: user.phoneCiphertext,
        iv: user.phoneIv,
        tag: user.phoneTag,
      }),
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
      grants: user.grants.map((grant) => ({
        id: grant.id,
        role: grant.role as CurrentUserView["grants"][number]["role"],
        districtId: grant.districtId,
        districtName: grant.district?.name ?? null,
      })),
    };
  }

  private setSessionCookie(
    response: Response,
    token: string,
    expires: Date,
  ): void {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "strict",
      path: "/",
      expires,
    });
  }
}
