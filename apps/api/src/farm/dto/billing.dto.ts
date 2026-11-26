import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class PayFarmPlanDto {
  @IsString()
  @MaxLength(40)
  planCode!: string;

  @IsIn(['MONTHLY', 'ANNUAL'])
  cycle!: 'MONTHLY' | 'ANNUAL';

  /** Not needed for the free plan. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class BuyFarmSmsDto {
  @IsString()
  @MaxLength(40)
  bundleCode!: string;

  @IsString()
  @MinLength(9)
  @MaxLength(20)
  phone!: string;
}

export class PayFarmFeesDto {
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  phone!: string;
}

export class FarmLimitsDto {
  @IsOptional() @IsNumber() @Min(0) head?: number | null;
  @IsOptional() @IsNumber() @Min(0) birds?: number | null;
  @IsOptional() @IsNumber() @Min(0) acres?: number | null;
  @IsOptional() @IsNumber() @Min(0) users?: number | null;
}

export class UpdateFarmPlanDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsString() @MaxLength(120) fits?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) monthlyPrice?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) annualPrice?: number | null;
  @IsOptional() @IsBoolean() quoteOnly?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) sortOrder?: number;

  /** null in a limit = unlimited. */
  @IsOptional() @ValidateNested() @Type(() => FarmLimitsDto) limits?: FarmLimitsDto;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) features?: string[];
}

export class ExtendFarmTrialDto {
  @IsInt()
  @Min(1)
  @Max(90)
  days!: number;
}

export class RecordFarmPaymentDto {
  @IsString() @MaxLength(40) planCode!: string;
  @IsIn(['MONTHLY', 'ANNUAL']) cycle!: 'MONTHLY' | 'ANNUAL';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100_000_000) amount!: number;
  @IsIn(['BANK', 'CHEQUE', 'CASH', 'MPESA']) method!: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}
