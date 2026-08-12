import { SPECIFIC_NEED_OPTIONS } from "@oms/contracts";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

export { SPECIFIC_NEED_OPTIONS };

@ValidatorConstraint({ name: "specificNeedOption", async: false })
class SpecificNeedOptionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === "string" &&
          (SPECIFIC_NEED_OPTIONS as readonly string[]).includes(item),
      )
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return "具体需求选项无效";
  }
}
import {
  CustomerAttitude,
  CustomerType,
  OpportunityState,
} from "../../generated/prisma/enums";

export class SubmitOpportunityDto {
  @IsEnum(CustomerType)
  customerType!: CustomerType;

  @IsUUID()
  districtId!: string;

  @IsString()
  @Length(1, 200)
  customerContact!: string;

  @IsArray()
  @ArrayMinSize(1, { message: "至少选择一项具体需求" })
  @ArrayMaxSize(2, { message: "具体需求最多选择两项" })
  @ArrayUnique({ message: "具体需求不能重复选择" })
  @IsString({ each: true })
  @Validate(SpecificNeedOptionConstraint)
  specificNeeds!: string[];

  @IsEnum(CustomerAttitude)
  attitude!: CustomerAttitude;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  oneSentenceDescription?: string;

  @IsBoolean()
  @Transform(({ value }) => value === true || value === "true")
  consentConfirmed!: boolean;
}

export class ResubmitOpportunityDto extends SubmitOpportunityDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ExpectedVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class FirstApproveDto extends ExpectedVersionDto {
  @IsUUID()
  handlerGrantId!: string;
}

export class ReturnDto extends ExpectedVersionDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class ReassignDto extends ExpectedVersionDto {
  @IsUUID()
  handlerGrantId!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class PauseDto extends ExpectedVersionDto {
  @IsISO8601({ strict: true })
  nextProcessingAt!: string;
}

export class SuccessResultDto extends ExpectedVersionDto {
  @IsString()
  @Length(1, 200)
  successOpportunityName!: string;
}

export class FailureResultDto extends ExpectedVersionDto {
  @IsString()
  @Length(1, 500)
  failureReason!: string;
}

export class OpportunityListQueryDto {
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
  @IsEnum(OpportunityState)
  state?: OpportunityState;

  @IsOptional()
  @IsUUID()
  districtId?: string;
}
