import { Body, Controller, Get, Headers, Ip, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { CurrentUserView } from "@oms/contracts";
import {
  CurrentIdentity,
  Public,
  RequireRoles,
} from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, LoginDto, ReauthDto } from "./auth.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Headers("user-agent") userAgent?: string,
    @Ip() ip?: string,
  ): Promise<CurrentUserView> {
    return this.auth.login(dto, response, userAgent, ip);
  }

  @Get("me")
  me(@CurrentIdentity() identity: AuthIdentity): CurrentUserView {
    return this.auth.toIdentityView(identity);
  }

  @Post("change-password")
  changePassword(
    @CurrentIdentity() identity: AuthIdentity,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(identity, dto);
  }

  @Post("reauth")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequireRoles("MUNICIPAL", "SENIOR_MUNICIPAL_ADMIN")
  reauth(@CurrentIdentity() identity: AuthIdentity, @Body() dto: ReauthDto) {
    return this.auth.createReauthToken(identity, dto.password);
  }

  @Post("logout")
  logout(
    @CurrentIdentity() identity: AuthIdentity,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.logout(identity, response);
  }
}
