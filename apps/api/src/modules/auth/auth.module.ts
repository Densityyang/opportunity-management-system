import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RoleGuard } from "./role.guard";
import { SessionGuard } from "./session.guard";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, RoleGuard],
  exports: [AuthService, SessionGuard, RoleGuard],
})
export class AuthModule {}
