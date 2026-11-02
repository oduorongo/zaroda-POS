import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ConRoleCode } from '@prisma/client';

export const PORTAL_ROLES: ConRoleCode[] = ['CON_CLIENT', 'CON_CONSULTANT_ARCH', 'CON_CONSULTANT_QS', 'CON_CONSULTANT_ENG', 'CON_SUBCONTRACTOR'];

export class PayrollRunDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class PayrollPayDto {
  @IsIn(['MPESA', 'MPESA_MANUAL', 'CASH'])
  method!: 'MPESA' | 'MPESA_MANUAL' | 'CASH';

  /** Leave out to pay everyone not yet paid. */
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(500)
  @IsOptional()
  lineIds?: string[];

  /** M-Pesa code for a payment made by hand, or a cash voucher number. */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;
}

export class PayoutSettingsDto {
  @IsIn(['sandbox', 'production'])
  environment!: 'sandbox' | 'production';

  @IsString()
  @MinLength(4)
  @MaxLength(12)
  shortcode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  initiator!: string;

  /** Left out = keep the one already saved. */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  consumerKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  consumerSecret?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  securityCredential?: string;
}

export class PortalUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsIn(PORTAL_ROLES)
  role!: ConRoleCode;

  @IsUUID()
  @IsOptional()
  partyId?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  projectIds!: string[];
}

export class PortalUserUpdateDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  projectIds?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class PortalCodeRequestDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;
}

export class PortalCodeVerifyDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class PortalCertifyDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  certifiedRef?: string;
}

export class PortalDecisionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

export class PortalInstructionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description!: string;
}

export class PortalSubValuationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000_000)
  grossToDate!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
