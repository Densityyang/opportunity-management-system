import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { MunicipalService } from "./municipal.service";
import {
  SuccessExportDto,
  SuccessLibraryQueryDto,
  WorkflowExportDto,
} from "./municipal.dto";

@ApiTags("municipal")
@RequireRoles("MUNICIPAL")
@Controller("municipal")
export class MunicipalController {
  constructor(private readonly municipal: MunicipalService) {}

  @Get("successes")
  list(
    @CurrentIdentity() identity: AuthIdentity,
    @Query() query: SuccessLibraryQueryDto,
  ) {
    return this.municipal.listSuccesses(identity, query);
  }

  @Get("successes/:opportunityId")
  detail(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("opportunityId") opportunityId: string,
  ) {
    return this.municipal.getSuccessDetail(identity, opportunityId);
  }

  @Post("exports/workflow")
  exportWorkflow(
    @CurrentIdentity() identity: AuthIdentity,
    @Headers("x-reauth-token") token: string | undefined,
    @Body() dto: WorkflowExportDto,
    @Res() response: Response,
  ) {
    return this.municipal.exportWorkflow(identity, token, dto, response);
  }

  @Post("exports/successes")
  exportSuccesses(
    @CurrentIdentity() identity: AuthIdentity,
    @Headers("x-reauth-token") token: string | undefined,
    @Body() dto: SuccessExportDto,
    @Res() response: Response,
  ) {
    return this.municipal.exportSuccesses(identity, token, dto, response);
  }
}
