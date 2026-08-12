import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RoleCode } from "@oms/contracts";
import type { Request } from "express";
import { REQUIRED_ROLES_KEY } from "../../common/auth.decorators";

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleCode[]>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;
    const identity = context.switchToHttp().getRequest<Request>().identity;
    if (!identity?.activeGrant || !roles.includes(identity.activeGrant.role)) {
      throw new ForbiddenException({
        message: "请选择具备该操作权限的当前角色",
        errorCode: "ACTIVE_ROLE_REQUIRED",
      });
    }
    return true;
  }
}
