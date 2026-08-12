import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnvironment } from "./common/config";
import { DatabaseModule } from "./common/database.module";
import { OriginGuard } from "./common/origin.guard";
import { HealthController } from "./health.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { RetentionModule } from "./modules/admin/retention.module";
import { AudioModule } from "./modules/audio/audio.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RoleGuard } from "./modules/auth/role.guard";
import { SessionGuard } from "./modules/auth/session.guard";
import { MunicipalModule } from "./modules/municipal/municipal.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { OpportunitiesModule } from "./modules/opportunities/opportunities.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    AuthModule,
    AdminModule,
    OpportunitiesModule,
    WorkflowModule,
    AudioModule,
    NotificationsModule,
    MunicipalModule,
    RetentionModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
  ],
})
export class AppModule {}
