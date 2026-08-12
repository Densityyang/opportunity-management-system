import { IsIn, IsString, Length } from "class-validator";

export class CompleteRetentionDto {
  @IsIn(["ANONYMIZE", "DELETE"])
  action!: "ANONYMIZE" | "DELETE";

  @IsString()
  @Length(1, 32)
  confirmationSerialNumber!: string;
}
