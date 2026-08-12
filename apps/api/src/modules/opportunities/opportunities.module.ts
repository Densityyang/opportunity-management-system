import { Module } from "@nestjs/common";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunityAccessService } from "./opportunity-access.service";
import { OpportunitiesService } from "./opportunities.service";

@Module({
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, OpportunityAccessService],
  exports: [OpportunitiesService, OpportunityAccessService],
})
export class OpportunitiesModule {}
