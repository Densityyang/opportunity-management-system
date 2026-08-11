import { Module } from "@nestjs/common";
import { AdminController, ReferenceController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminController, ReferenceController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
