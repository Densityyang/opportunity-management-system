import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import {
  ExpectedVersionDto,
  FailureResultDto,
  PauseDto,
  ReassignDto,
  ReturnDto,
  SuccessResultDto,
} from "../opportunities/opportunity.dto";
import { WorkflowService } from "./workflow.service";

@ApiTags("workflow")
@Controller("opportunities/:opportunityId")
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @RequireRoles("DISTRICT_MANAGER")
  @Post("reviews/first/approve")
  firstApprove(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: ExpectedVersionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.firstApprove(identity, id, dto, key);
  }

  @RequireRoles("DISTRICT_MANAGER")
  @Post("reviews/first/return")
  firstReturn(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: ReturnDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.firstReturn(identity, id, dto, key);
  }

  @RequireRoles("DISTRICT_MANAGER")
  @Post("assignments/reassign")
  reassign(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: ReassignDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.reassign(identity, id, dto, key);
  }

  @RequireRoles("PERSONAL_HANDLER", "ORGANIZATION_HANDLER")
  @Post("pause")
  pause(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: PauseDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.pause(identity, id, dto, key);
  }

  @RequireRoles("PERSONAL_HANDLER", "ORGANIZATION_HANDLER")
  @Post("resume")
  resume(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: ExpectedVersionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.resume(identity, id, dto, key);
  }

  @RequireRoles("PERSONAL_HANDLER", "ORGANIZATION_HANDLER")
  @Post("results/success")
  success(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: SuccessResultDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.submitSuccess(identity, id, dto, key);
  }

  @RequireRoles("PERSONAL_HANDLER", "ORGANIZATION_HANDLER")
  @Post("results/failure")
  failure(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: FailureResultDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.submitFailure(identity, id, dto, key);
  }

  @RequireRoles("DISTRICT_MANAGER")
  @Post("reviews/final/approve")
  finalApprove(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: ExpectedVersionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.finalApprove(identity, id, dto, key);
  }

  @RequireRoles("DISTRICT_MANAGER")
  @Post("reviews/final/return")
  finalReturn(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") id: string,
    @Body() dto: ReturnDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.workflow.finalReturn(identity, id, dto, key);
  }
}
