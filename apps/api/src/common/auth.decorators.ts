import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { RoleCode } from "@oms/contracts";
import type { Request } from "express";
import type { AuthIdentity } from "./auth.types";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_ROLES_KEY = "requiredRoles";
export const RequireRoles = (...roles: RoleCode[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthIdentity => {
    const identity = context.switchToHttp().getRequest<Request>().identity;
    if (!identity) throw new Error("Identity is unavailable");
    return identity;
  },
);
