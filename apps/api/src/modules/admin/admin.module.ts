import { Module } from "@nestjs/common";
import { AdminController, ReferenceController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PersonnelService } from "./personnel.service";
import { AdministrationPolicyService } from "./admin-policy.service";

@Module({
  controllers: [AdminController, ReferenceController],
  providers: [AdminService, PersonnelService, AdministrationPolicyService],
  exports: [AdminService, AdministrationPolicyService],
})
export class AdminModule {}
