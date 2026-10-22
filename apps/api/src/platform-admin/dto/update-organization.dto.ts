import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const INDUSTRY_TYPES = ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON', 'RENTAL', 'SCHOOL_SUPPLIER'] as const;

/** Every field optional - a platform admin edits whichever subset of the profile needs correcting, not the whole record at once. */
export class UpdateOrganizationDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsIn(INDUSTRY_TYPES)
  @IsOptional()
  industryType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2)
  country?: string;

  @IsString()
  @IsOptional()
  @MaxLength(3)
  baseCurrency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  kraPin?: string;

  @IsBoolean()
  @IsOptional()
  vatRegistered?: boolean;
}

export class SetOrganizationActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class SetOnlineStoreAddonDto {
  @IsBoolean()
  addonActive!: boolean;

  // Fraction (0.03 = 3%). null resets to the platform default; omitted
  // leaves whatever is set (IsOptional skips validation for both). Capped
  // at 50% as a guard against typing 3 when 0.03 was meant.
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(0.5)
  @IsOptional()
  commissionRate?: number | null;
}
