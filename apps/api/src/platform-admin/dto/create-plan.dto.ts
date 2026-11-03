import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

const TIERS = ['ONLINE_ONLY', 'BASIC', 'STANDARD', 'PREMIUM', 'SEASONAL'] as const;

export class CreatePlanDto {
  @IsIn(TIERS)
  tier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsNumber()
  @Min(0)
  priceKes!: number;

  @IsInt()
  @Min(0)
  maxDevices!: number;

  @IsInt()
  @IsPositive()
  maxBranches!: number;

  @IsInt()
  @IsPositive()
  @IsOptional()
  billingPeriodDays?: number;

  /** SEASONAL: billed in school-term instalments of annualPriceKes (see Seasonal billing settings). */
  @IsIn(['MONTHLY', 'SEASONAL'])
  @IsOptional()
  billingCycle?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  annualPriceKes?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
