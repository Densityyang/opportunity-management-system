import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { OpportunitiesService } from "./opportunities.service";
import {
  OpportunityListQueryDto,
  ResubmitOpportunityDto,
  SubmitOpportunityDto,
} from "./opportunity.dto";

@ApiTags("opportunities")
@Controller("opportunities")
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @RequireRoles("FIELD_REPORTER")
  @Post()
  submit(
    @CurrentIdentity() identity: AuthIdentity,
    @Body() dto: SubmitOpportunityDto,
  ) {
    return this.opportunities.submit(identity, dto);
  }

  @Get()
  list(
    @CurrentIdentity() identity: AuthIdentity,
    @Query() query: OpportunityListQueryDto,
  ) {
    return this.opportunities.list(identity, query);
  }

  @Get(":opportunityId")
  detail(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
  ) {
    return this.opportunities.getDetail(identity, opportunityId);
  }

  @Get(":opportunityId/timeline")
  timeline(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
  ) {
    return this.opportunities.timeline(identity, opportunityId);
  }

  @RequireRoles("FIELD_REPORTER")
  @Put(":opportunityId/resubmit")
  resubmit(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
    @Body() dto: ResubmitOpportunityDto,
  ) {
    return this.opportunities.resubmit(identity, opportunityId, dto);
  }
}
