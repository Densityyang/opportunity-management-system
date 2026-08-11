import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsISO8601,
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

export class SuccessLibraryQueryDto {
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
  @IsUUID()
  districtId?: string;

  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @IsOptional()
  @IsEnum(CustomerAttitude)
  attitude?: CustomerAttitude;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  successOpportunityName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  customerContact?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  closedFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  closedTo?: string;
}

export class WorkflowExportDto {
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @IsOptional()
  @IsEnum(OpportunityState)
  state?: OpportunityState;

  @IsOptional()
  @IsISO8601({ strict: true })
  submittedFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  submittedTo?: string;
}

export class SuccessExportDto extends SuccessLibraryQueryDto {}
