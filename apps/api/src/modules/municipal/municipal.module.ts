import { Module } from "@nestjs/common";
import { OpportunitiesModule } from "../opportunities/opportunities.module";
import { MunicipalController } from "./municipal.controller";
import { MunicipalService } from "./municipal.service";

@Module({
  imports: [OpportunitiesModule],
  controllers: [MunicipalController],
  providers: [MunicipalService],
})
export class MunicipalModule {}
