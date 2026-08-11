import { RoleCode } from "../../generated/prisma/enums";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入有效的中国大陆手机号码" })
  phone!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;

  @IsString()
  @Length(12, 128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: "初始密码须同时包含大写字母、小写字母和数字",
  })
  initialPassword!: string;
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
  @IsString()
  @Length(12, 128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  initialPassword!: string;
}

export class CreateRoleGrantDto {
  @IsEnum(RoleCode)
  role!: RoleCode;

  @IsOptional()
  @IsUUID()
  districtId?: string;
}

export class UpdateDistrictDto {
  @IsBoolean()
  enabled!: boolean;
}

export class UpsertRoutingDto {
  @IsUUID()
  managerGrantId!: string;

  @IsUUID()
  personalHandlerGrantId!: string;

  @IsUUID()
  organizationHandlerGrantId!: string;
}

export class PageQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
