import { IsEmail, IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

const INDUSTRY_TYPES = ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON'] as const;

/** Admin-driven onboarding (distinct from the public self-service /auth/register): the tenant starts ACTIVE on a chosen plan, not on a trial. */
export class OnboardTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  organizationName!: string;

  @IsIn(INDUSTRY_TYPES)
  industryType!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  kraPin?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  ownerFullName!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsString()
  @MinLength(8)
  ownerPassword!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  branchName!: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  terminalCount?: number;

  // Plan.tier, e.g. "BASIC" - validated by existence lookup in the
  // service (findUniqueOrThrow), not an @IsIn here, since tiers are data
  // (Plan rows), not a fixed code-level enum.
  @IsString()
  planTier!: string;
}
