import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

const TIERS = ['BASIC', 'STANDARD', 'PREMIUM'] as const;

export class CreatePlanDto {
  @IsIn(TIERS)
  tier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsNumber()
  @IsPositive()
  priceKes!: number;

  @IsInt()
  @IsPositive()
  maxDevices!: number;

  @IsInt()
  @IsPositive()
  maxBranches!: number;

  @IsInt()
  @IsPositive()
  @IsOptional()
  billingPeriodDays?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
