import { SalesAgentStatus, SalesTeamStatus } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Rates are fractions: 0.3 = 30%. */
export class CreateSalesTeamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  memberShareRate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  leaderOverrideRate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  onboardingBonusKes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  subscriptionShareRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  earningMonths?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  payoutCapRate?: number;
}

export class UpdateSalesTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string;

  @IsOptional()
  @IsEnum(SalesTeamStatus)
  status?: SalesTeamStatus;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  memberShareRate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  leaderOverrideRate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  onboardingBonusKes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  subscriptionShareRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  earningMonths?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  payoutCapRate?: number;
}

export class CreateSalesAgentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @Matches(/^(\+?254|0)\d{9}$/, { message: 'Enter a Kenyan phone number, e.g. 0712 345 678' })
  phone?: string;

  // Only for adding a leader to a team that already has one: the current leader is suspended first.
  @IsOptional()
  @IsBoolean()
  replaceExistingLeader?: boolean;
}

export class SetSalesAgentStatusDto {
  @IsEnum(SalesAgentStatus)
  status!: SalesAgentStatus;
}

export class SalesAgentLoginDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class SalesAgentChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'The new password must be at least 8 characters' })
  @MaxLength(200)
  newPassword!: string;
}
