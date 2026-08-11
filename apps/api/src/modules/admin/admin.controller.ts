import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { forbidden } from "../../common/http-error";
import { AdminService } from "./admin.service";
import {
  CreateRoleGrantDto,
  CreateUserDto,
  PageQueryDto,
  ResetPasswordDto,
  UpdateDistrictDto,
  UpdateUserDto,
  UpsertRoutingDto,
} from "./admin.dto";

@ApiTags("admin")
@RequireRoles("SYSTEM_ADMIN")
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("users")
  listUsers(@Query() query: PageQueryDto) {
    return this.admin.listUsers(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
  }

  @Post("users")
  createUser(@Body() dto: CreateUserDto) {
    return this.admin.createUser(dto);
  }

  @Patch("users/:userId")
  updateUser(@Param("userId") userId: string, @Body() dto: UpdateUserDto) {
    return this.admin.updateUser(userId, dto);
  }

  @Post("users/:userId/reset-password")
  resetPassword(
    @Param("userId") userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.admin.resetPassword(userId, dto);
  }

  @Post("users/:userId/grants")
  createGrant(
    @Param("userId") userId: string,
    @Body() dto: CreateRoleGrantDto,
  ) {
    return this.admin.createGrant(userId, dto);
  }

  @Delete("grants/:grantId")
  deactivateGrant(@Param("grantId") grantId: string) {
    return this.admin.deactivateGrant(grantId);
  }

  @Get("districts")
  listDistricts() {
    return this.admin.listDistricts(true);
  }

  @Patch("districts/:districtId")
  updateDistrict(
    @Param("districtId") districtId: string,
    @Body() dto: UpdateDistrictDto,
  ) {
    return this.admin.updateDistrict(districtId, dto.enabled);
  }

  @Get("routing")
  listRouting() {
    return this.admin.listRouting();
  }

  @Post("districts/:districtId/routing")
  upsertRouting(
    @Param("districtId") districtId: string,
    @Body() dto: UpsertRoutingDto,
  ) {
    return this.admin.upsertRouting(districtId, dto);
  }
}

@ApiTags("reference")
@Controller("reference")
export class ReferenceController {
  constructor(private readonly admin: AdminService) {}

  @Get("districts")
  listDistricts() {
    return this.admin.listDistricts(false);
  }

  @Get("handlers")
  listHandlers(
    @CurrentIdentity() identity: AuthIdentity,
    @Query("districtId") districtId: string,
    @Query("customerType") customerType: "PERSONAL" | "ORGANIZATION",
  ) {
    if (!districtId || !["PERSONAL", "ORGANIZATION"].includes(customerType))
      throw forbidden("参数无效");
    const grant = identity.activeGrant;
    if (
      !grant ||
      (grant.role !== "SYSTEM_ADMIN" &&
        (grant.role !== "DISTRICT_MANAGER" || grant.districtId !== districtId))
    ) {
      throw forbidden();
    }
    return this.admin.listHandlers(districtId, customerType);
  }
}
