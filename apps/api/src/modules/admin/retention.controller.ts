import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { CompleteRetentionDto } from "./retention.dto";
import { RetentionService } from "./retention.service";

@ApiTags("retention")
@RequireRoles("SYSTEM_ADMIN")
@Controller("admin/retention")
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  list(@Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.retention.list(Number(page ?? 1), Number(pageSize ?? 50));
  }

  @Post(":candidateId/complete")
  complete(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("candidateId") candidateId: string,
    @Body() dto: CompleteRetentionDto,
  ) {
    return this.retention.complete(identity, candidateId, dto);
  }
}
