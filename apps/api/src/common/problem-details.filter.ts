import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = error instanceof HttpException ? error.getResponse() : null;
    const detail =
      typeof payload === "string"
        ? payload
        : payload && typeof payload === "object" && "message" in payload
          ? Array.isArray(payload.message)
            ? payload.message.join("; ")
            : String(payload.message)
          : status === 500
            ? "服务器内部错误"
            : "请求失败";
    const code =
      payload && typeof payload === "object" && "errorCode" in payload
        ? String(payload.errorCode)
        : `HTTP_${status}`;

    response
      .status(status)
      .type("application/problem+json")
      .send({
        type: `https://oms.local/problems/${code.toLowerCase()}`,
        title: HttpStatus[status] ?? "Error",
        status,
        detail,
        instance: request.originalUrl,
        errorCode: code,
        traceId: request.headers["x-request-id"] ?? null,
      });
  }
}
