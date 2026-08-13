import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { RoleCode } from "../../generated/prisma/enums";

export class CreateRoleGrantDto {
  @IsEnum(RoleCode)
  role!: RoleCode;

  @IsOptional()
  @IsUUID()
  districtId?: string;
}

export class CreateUserDto {
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入有效的中国大陆手机号码" })
  phone!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRoleGrantDto)
  grants!: CreateRoleGrantDto[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ResetPasswordDto {
  // The server derives the reset password from the target user's phone.
}

export class UpdateDistrictDto {
  @IsBoolean()
  enabled!: boolean;
}

export class UserListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  search?: string;

  @IsOptional()
  @IsEnum(RoleCode)
  role?: RoleCode;

  @IsOptional()
  @IsUUID()
  districtId?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === "true"
      ? true
      : value === false || value === "false"
        ? false
        : value,
  )
  @IsBoolean()
  active?: boolean;
}
