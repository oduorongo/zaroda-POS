import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `industryType` stays a plain string on Organization (see schema.prisma's
 * comment - not a DB enum), but this is the one place a value for it is
 * ever accepted from a client, so it's validated against the same set the
 * vertical modules actually register manifests for (ModuleRegistryService).
 */
const INDUSTRY_TYPES = ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON'] as const;

export class RegisterOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  organizationName!: string;

  @IsIn(INDUSTRY_TYPES)
  industryType!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2)
  country?: string;

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

  @IsString()
  @IsOptional()
  @MaxLength(100)
  terminalLabel?: string;
}
