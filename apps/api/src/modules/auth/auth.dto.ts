import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "13800000000" })
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入有效的中国大陆手机号码" })
  phone!: string;

  @ApiProperty({ minLength: 6, maxLength: 12 })
  @IsString()
  @Length(6, 12, { message: "密码长度须为 6 至 12 位" })
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(6, 12, { message: "当前密码长度须为 6 至 12 位" })
  currentPassword!: string;

  @IsString()
  @Length(6, 12, { message: "新密码长度须为 6 至 12 位" })
  newPassword!: string;
}

export class ReauthDto {
  @IsString()
  @Length(6, 12, { message: "密码长度须为 6 至 12 位" })
  password!: string;
}
