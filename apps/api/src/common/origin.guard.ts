import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed = new Set(
    (
      process.env.ALLOWED_ORIGINS ??
      "http://localhost:8080,http://localhost:5173"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const origin = request.headers.origin;
    if (!origin || this.allowed.has(origin)) return true;
    throw new ForbiddenException({
      message: "来源校验失败",
      errorCode: "INVALID_ORIGIN",
    });
  }
}
