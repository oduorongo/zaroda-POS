import { SalesAgentStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const INDUSTRY_TYPES = ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON', 'RENTAL', 'SCHOOL_SUPPLIER', 'HOTEL'] as const;

/**
 * A team member signing a shop up. The shop starts on a 14-day free trial of the entry plan, like a self-signup.
 * The owner's password may be chosen on the spot; if it is left out, a temporary one is made and shown once.
 */
export class OnboardTenantByAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  organizationName!: string;

  @IsIn(INDUSTRY_TYPES)
  industryType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  ownerFullName!: string;

  @IsEmail()
  @MaxLength(200)
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  ownerPassword?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  branchName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  county?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  kraPin?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  terminalCount?: number;
}

export class AddMemberDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class SetMemberStatusDto {
  @IsEnum(SalesAgentStatus)
  status!: SalesAgentStatus;
}
