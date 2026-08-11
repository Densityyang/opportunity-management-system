import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
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

  @IsString()
  @Length(1, 2000)
  specificNeed!: string;

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
