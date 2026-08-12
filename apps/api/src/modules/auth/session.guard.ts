import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../../common/auth.decorators";
import type { AuthGrant } from "../../common/auth.types";
import { CryptoService } from "../../common/crypto.service";
import { PrismaService } from "../../common/prisma.service";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.oms_session as string | undefined;
    if (!token) throw this.unauthorized();

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.hashOpaqueToken(token) },
      include: {
        user: {
          include: {
            grants: { where: { active: true }, include: { district: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.active
    )
      throw this.unauthorized();

    const grants: AuthGrant[] = session.user.grants.map((grant) => ({
      id: grant.id,
      role: grant.role,
      districtId: grant.districtId,
      districtName: grant.district?.name ?? null,
    }));
    const requestedGrantId = request.header("X-Role-Grant-Id");
    const activeGrant = requestedGrantId
      ? (grants.find((grant) => grant.id === requestedGrantId) ?? null)
      : null;
    if (requestedGrantId && !activeGrant) {
      throw new UnauthorizedException({
        message: "角色授权无效或已停用",
        errorCode: "INVALID_ROLE_GRANT",
      });
    }
    request.identity = {
      id: session.user.id,
      phone: this.crypto.decrypt({
        ciphertext: session.user.phoneCiphertext,
        iv: session.user.phoneIv,
        tag: session.user.phoneTag,
      }),
      displayName: session.user.displayName,
      mustChangePassword: session.user.mustChangePassword,
      grants,
      activeGrant,
      sessionId: session.id,
    };

    if (
      session.user.mustChangePassword &&
      !["/auth/me", "/auth/change-password", "/auth/logout"].some((suffix) =>
        request.originalUrl.split("?")[0]?.endsWith(suffix),
      )
    ) {
      throw new UnauthorizedException({
        message: "首次登录必须先修改密码",
        errorCode: "PASSWORD_CHANGE_REQUIRED",
      });
    }
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      message: "登录已失效，请重新登录",
      errorCode: "SESSION_INVALID",
    });
  }
}
