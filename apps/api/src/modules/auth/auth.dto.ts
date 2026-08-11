import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "13800000000" })
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入有效的中国大陆手机号码" })
  phone!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @Length(12, 128, { message: "新密码长度须为 12 至 128 位" })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: "新密码须同时包含大写字母、小写字母和数字",
  })
  newPassword!: string;
}

export class ReauthDto {
  @IsString()
  @MinLength(8)
  password!: string;
}
