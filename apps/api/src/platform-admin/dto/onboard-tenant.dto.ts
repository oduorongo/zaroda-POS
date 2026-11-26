import { IsEmail, IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength, Min } from 'class-validator';

const INDUSTRY_TYPES = ['RETAIL', 'RESTAURANT', 'SALON', 'RENTAL', 'SCHOOL_SUPPLIER', 'UNIFORM_MAKER', 'HOTEL'] as const;

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

  // First branch's location - shown in the tenant list so support/onboarding
  // can tell shops apart by where they actually are, not just by name.
  @IsString()
  @IsOptional()
  @MaxLength(100)
  county?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  subCounty?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  terminalCount?: number;

  // Plan.tier, e.g. "BASIC" - validated by existence lookup in the
  // service (findUniqueOrThrow), not an @IsIn here, since tiers are data
  // (Plan rows), not a fixed code-level enum.
  @IsString()
  planTier!: string;

  /** The agreed monthly price, inside the plan's range (Basic: 1,000 - 2,500). Left out: the plan's full price. */
  @IsInt()
  @IsPositive()
  @IsOptional()
  monthlyPriceKes?: number;

  /** How the business pays: monthly, the year at once, or the year in the plan's instalments. */
  @IsIn(['MONTHLY', 'ANNUAL', 'INSTALMENTS'])
  @IsOptional()
  billingChoice?: 'MONTHLY' | 'ANNUAL' | 'INSTALMENTS';

  /** Extra tills beyond the plan's (Basic: at most 1), each at the agreed price. */
  @IsInt()
  @Min(0)
  @IsOptional()
  extraTills?: number;
}
