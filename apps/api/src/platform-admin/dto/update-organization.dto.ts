import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const INDUSTRY_TYPES = ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON'] as const;

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
