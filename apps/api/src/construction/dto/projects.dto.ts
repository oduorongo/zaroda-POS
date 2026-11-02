import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ConFormOfContract, ConPartyKind, ConPermitStatus, ConProjectStatus, ConRoleCode, ConRuleMode, ConWorksClass } from '@prisma/client';

const PROJECT_ROLES: ConRoleCode[] = ['CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER', 'CON_TIMEKEEPER'];

export class TenderDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  ref?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  procuringEntity!: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsBoolean()
  @IsOptional()
  agpoReserved?: boolean;

  @IsEnum(ConWorksClass)
  worksClass!: ConWorksClass;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estValue!: number;

  @IsDateString()
  @IsOptional()
  closingAt?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  bidBond?: number;

  @IsDateString({ strict: true })
  @IsOptional()
  bidBondExpiresAt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  /** Director only: take on work above the NCA cap. */
  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(300)
  overrideReason?: string;
}

export class TenderOutcomeDto {
  @IsIn(['SUBMITTED', 'WON', 'LOST', 'WITHDRAWN'])
  status!: 'SUBMITTED' | 'WON' | 'LOST' | 'WITHDRAWN';

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;

  /** The awarded sum when it differs from the estimate. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  awardedSum?: number;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

export class PartyDto {
  @IsEnum(ConPartyKind)
  kind!: ConPartyKind;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  contactPerson?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  kraPin?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

export class ProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(30)
  code?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsUUID()
  @IsOptional()
  clientId?: string;

  @IsEnum(ConWorksClass)
  worksClass!: ConWorksClass;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  contractSum!: number;

  @IsEnum(ConFormOfContract)
  @IsOptional()
  formOfContract?: ConFormOfContract;

  @IsDateString({ strict: true })
  @IsOptional()
  startDate?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  completionDate?: string;

  @IsInt()
  @Min(0)
  @Max(60)
  @IsOptional()
  dlpMonths?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  retentionRate?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  retentionLimit?: number;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  county?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  location?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  lat?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  lng?: number;

  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(300)
  overrideReason?: string;
}

export class ProjectStatusDto {
  @IsEnum(ConProjectStatus)
  status!: ConProjectStatus;

  /** Go ahead despite the warnings shown. */
  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

export class ProjectPartyDto {
  @IsUUID()
  partyId!: string;

  @IsIn(['ARCHITECT', 'QS', 'ENGINEER', 'SUBCONTRACTOR', 'OTHER'])
  role!: ConPartyKind;
}

export class MemberDto {
  @IsUUID()
  orgUserId!: string;

  @IsIn(PROJECT_ROLES)
  role!: ConRoleCode;
}

export class AccreditationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  cardNo!: string;

  @IsDateString({ strict: true })
  expiresAt!: string;
}

export class PermitDto {
  @IsEnum(ConPermitStatus)
  status!: ConPermitStatus;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  refNo?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  issuedAt?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  expiresAt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class MilestoneDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  percentComplete?: number;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

export class BqSectionDto {
  @IsString()
  @IsOptional()
  @MaxLength(20)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class BqItemDto {
  @IsUUID()
  sectionId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  qty!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  rate!: number;
}

export class RulesDto {
  @IsEnum(ConRuleMode)
  ncaProjectRegRule!: ConRuleMode;
}
