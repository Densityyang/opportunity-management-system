import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

export const notFound = (message = "记录不存在") =>
  new NotFoundException({ message, errorCode: "NOT_FOUND" });

export const forbidden = (message = "无权执行此操作") =>
  new ForbiddenException({ message, errorCode: "FORBIDDEN" });

export const versionConflict = () =>
  new ConflictException({
    message: "数据已被其他人更新，请刷新后重试",
    errorCode: "VERSION_CONFLICT",
  });

export const invalidTransition = () =>
  new UnprocessableEntityException({
    message: "当前状态不允许执行此操作",
    errorCode: "INVALID_TRANSITION",
  });
