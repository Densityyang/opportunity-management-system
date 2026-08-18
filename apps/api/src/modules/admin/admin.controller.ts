import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CurrentIdentity, RequireRoles } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { forbidden } from "../../common/http-error";
import {
  CreateRoleGrantDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateDistrictDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./admin.dto";
import { AdminService } from "./admin.service";
import {
  CreatePersonnelAccountDto,
  PersonnelImportDto,
  PersonnelAccountBatchItemQueryDto,
  PersonnelAccountBatchPreviewDto,
  PersonnelDistrictRuleDto,
  PersonnelListQueryDto,
  PersonnelPositionDto,
  UpdatePersonnelPositionDto,
} from "./personnel.dto";
import { PersonnelService } from "./personnel.service";
import { PersonnelBatchService } from "./personnel-batch.service";
import type { Response } from "express";

@ApiTags("admin")
@RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN", "DISTRICT_MANAGER")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly personnel: PersonnelService,
    private readonly personnelBatch: PersonnelBatchService,
  ) {}

  @Get("capabilities")
  capabilities(@CurrentIdentity() identity: AuthIdentity) {
    return this.admin.capabilities(identity);
  }

  @Get("users")
  listUsers(
    @CurrentIdentity() identity: AuthIdentity,
    @Query() query: UserListQueryDto,
  ) {
    return this.admin.listUsers(identity, query);
  }

  @Post("users")
  createUser(
    @CurrentIdentity() identity: AuthIdentity,
    @Body() dto: CreateUserDto,
  ) {
    return this.admin.createUser(identity, dto);
  }

  @Patch("users/:userId")
  updateUser(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("userId") userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.admin.updateUser(identity, userId, dto);
  }

  @Post("users/:userId/reset-password")
  resetPassword(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("userId") userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.admin.resetPassword(identity, userId, dto);
  }

  @Post("users/:userId/grants")
  createGrant(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("userId") userId: string,
    @Body() dto: CreateRoleGrantDto,
  ) {
    return this.admin.createGrant(identity, userId, dto);
  }

  @Delete("grants/:grantId")
  deactivateGrant(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("grantId") grantId: string,
  ) {
    return this.admin.deactivateGrant(identity, grantId);
  }

  @Get("districts")
  listDistricts(@CurrentIdentity() identity: AuthIdentity) {
    return this.admin.listDistricts(identity);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Patch("districts/:districtId")
  updateDistrict(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("districtId") districtId: string,
    @Body() dto: UpdateDistrictDto,
  ) {
    return this.admin.updateDistrict(identity, districtId, dto.enabled);
  }

  @RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN")
  @Get("personnel")
  listPersonnel(
    @CurrentIdentity() identity: AuthIdentity,
    @Query() query: PersonnelListQueryDto,
  ) {
    return this.personnel.list(identity, query);
  }

  @RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN")
  @Get("personnel/imports")
  listPersonnelImports(@CurrentIdentity() identity: AuthIdentity) {
    return this.personnel.listImports(identity);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Post("personnel/import")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    }),
  )
  importPersonnel(
    @CurrentIdentity() identity: AuthIdentity,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: PersonnelImportDto,
  ) {
    return this.personnel.importWorkbook(identity, file, dto);
  }

  @RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN")
  @Post("personnel/:personnelId/account")
  createPersonnelAccount(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("personnelId") personnelId: string,
    @Body() dto: CreatePersonnelAccountDto,
  ) {
    return this.personnel.createAccount(identity, personnelId, dto);
  }

  @RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN")
  @Get("personnel-positions")
  listPersonnelPositions(@CurrentIdentity() identity: AuthIdentity) {
    return this.personnel.listPositions(identity);
  }

  @RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN")
  @Post("personnel-positions")
  createPersonnelPosition(
    @CurrentIdentity() identity: AuthIdentity,
    @Body() dto: PersonnelPositionDto,
  ) {
    return this.personnel.createPosition(identity, dto);
  }

  @RequireRoles("SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN")
  @Patch("personnel-positions/:positionId")
  updatePersonnelPosition(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("positionId") positionId: string,
    @Body() dto: UpdatePersonnelPositionDto,
  ) {
    return this.personnel.updatePosition(identity, positionId, dto);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Get("personnel-district-rules")
  listPersonnelDistrictRules(@CurrentIdentity() identity: AuthIdentity) {
    return this.personnelBatch.listRules(identity);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Post("personnel-district-rules")
  createPersonnelDistrictRule(
    @CurrentIdentity() identity: AuthIdentity,
    @Body() dto: PersonnelDistrictRuleDto,
  ) {
    return this.personnelBatch.createRule(identity, dto);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Patch("personnel-district-rules/:ruleId")
  updatePersonnelDistrictRule(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("ruleId") ruleId: string,
    @Body() dto: PersonnelDistrictRuleDto,
  ) {
    return this.personnelBatch.updateRule(identity, ruleId, dto);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Post("personnel/account-batches/preview")
  previewPersonnelAccountBatch(
    @CurrentIdentity() identity: AuthIdentity,
    @Body() dto: PersonnelAccountBatchPreviewDto,
  ) {
    return this.personnelBatch.preview(identity, dto);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Post("personnel/account-batches/:batchId/execute")
  executePersonnelAccountBatch(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("batchId") batchId: string,
  ) {
    return this.personnelBatch.execute(identity, batchId);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Get("personnel/account-batches")
  listPersonnelAccountBatches(@CurrentIdentity() identity: AuthIdentity) {
    return this.personnelBatch.listBatches(identity);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Get("personnel/account-batches/:batchId")
  getPersonnelAccountBatch(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("batchId") batchId: string,
  ) {
    return this.personnelBatch.getBatch(identity, batchId);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Get("personnel/account-batches/:batchId/items")
  listPersonnelAccountBatchItems(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("batchId") batchId: string,
    @Query() query: PersonnelAccountBatchItemQueryDto,
  ) {
    return this.personnelBatch.listItems(identity, batchId, query);
  }

  @RequireRoles("SYSTEM_ADMIN")
  @Post("personnel/account-batches/:batchId/export")
  exportPersonnelAccountBatch(
    @CurrentIdentity() identity: AuthIdentity,
    @Headers("x-reauth-token") token: string | undefined,
    @Param("batchId") batchId: string,
    @Res() response: Response,
  ) {
    return this.personnelBatch.exportBatch(identity, batchId, token, response);
  }
}

@ApiTags("reference")
@Controller("reference")
export class ReferenceController {
  constructor(private readonly admin: AdminService) {}

  @Get("districts")
  listDistricts() {
    return this.admin.listReferenceDistricts();
  }

  @RequireRoles("DISTRICT_MANAGER")
  @Get("handlers")
  listHandlers(
    @CurrentIdentity() identity: AuthIdentity,
    @Query("districtId") districtId: string,
    @Query("customerType") customerType: "PERSONAL" | "ORGANIZATION",
  ) {
    if (!districtId || !["PERSONAL", "ORGANIZATION"].includes(customerType))
      throw forbidden("参数无效");
    if (identity.activeGrant?.districtId !== districtId) throw forbidden();
    return this.admin.listHandlers(districtId, customerType);
  }
}
