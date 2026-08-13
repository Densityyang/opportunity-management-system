import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { RoleCode } from "../../generated/prisma/enums";
import { CreateRoleGrantDto } from "./admin.dto";

export enum PersonnelImportModeDto {
  UPSERT = "UPSERT",
  SNAPSHOT = "SNAPSHOT",
}

const booleanValue = ({ value }: { value: unknown }) =>
  value === true || value === "true"
    ? true
    : value === false || value === "false"
      ? false
      : value;

export class PersonnelImportDto {
  @IsOptional()
  @IsEnum(PersonnelImportModeDto)
  mode: PersonnelImportModeDto = PersonnelImportModeDto.UPSERT;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean()
  dryRun = false;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean()
  createAccounts = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  provisionSystemAdminCount = 0;

  @IsOptional()
  @Matches(/^1[3-9]\d{9}$/, { message: "系统管理员手机号格式无效" })
  provisionSystemAdminPhone?: string;
}

export class PersonnelListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean()
  active?: boolean;
}

export class PersonnelPositionDto {
  @IsString()
  @Length(1, 40)
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsArray()
  @ArrayMaxSize(7)
  @IsEnum(RoleCode, { each: true })
  roles: RoleCode[] = [];
}

export class UpdatePersonnelPositionDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsEnum(RoleCode, { each: true })
  roles?: RoleCode[];
}

export class CreatePersonnelAccountDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRoleGrantDto)
  grants!: CreateRoleGrantDto[];
}
