import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ConBillingCycle, ConDocType, ConRoleCode, ConWorksClass } from '@prisma/client';
import { TAX_KEYS } from '../common/con-defaults';

export class RegistrationDto {
  @IsEnum(ConWorksClass)
  worksClass!: ConWorksClass;

  @IsInt()
  @Min(1)
  @Max(8)
  ncaCategory!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  regNo!: string;

  @IsDateString({ strict: true })
  @IsOptional()
  registeredAt?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  licenceExpiresAt?: string;
}

export class ComplianceDocDto {
  @IsEnum(ConDocType)
  type!: ConDocType;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

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

  @IsUUID()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class CategoryLimitDto {
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxValue!: number | null;
}

export class TaxSettingDto {
  @IsIn(TAX_KEYS)
  key!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  rate!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  threshold?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  notes?: string;
}

export class RoleLimitDto {
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  approvalLimit!: number | null;
}

export class SetUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsEnum(ConRoleCode, { each: true })
  roles!: ConRoleCode[];
}

export class CapCheckDto {
  @IsEnum(ConWorksClass)
  worksClass!: ConWorksClass;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  value!: number;
}

export class PayPlanDto {
  @IsString()
  @MaxLength(40)
  planCode!: string;

  @IsEnum(ConBillingCycle)
  cycle!: ConBillingCycle;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  couponCode?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  extraProjects?: number;
}

export class QuoteQueryDto {
  @IsString()
  @MaxLength(40)
  planCode!: string;

  @IsEnum(ConBillingCycle)
  cycle!: ConBillingCycle;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  couponCode?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  extraProjects?: number;
}

// ── Platform admin ──

export class UpdateConPlanDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  fits?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  monthlyPrice?: number;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  annualPrice?: number | null;

  @IsBoolean()
  @IsOptional()
  quoteOnly?: boolean;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  setupFee?: number | null;

  @IsBoolean()
  @IsOptional()
  setupFeeOptional?: boolean;

  @IsObject()
  @IsOptional()
  limits?: Record<string, number | null>;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CouponDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  percentOff!: number;

  @IsInt()
  @Min(1)
  @Max(24)
  months!: number;

  @IsDateString({ strict: true })
  @IsOptional()
  validUntil?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ExtendTrialDto {
  @IsInt()
  @Min(1)
  @Max(90)
  days!: number;
}

export class ApplyCouponDto {
  @IsString()
  @MaxLength(40)
  code!: string;
}

export class RecordConPaymentDto {
  @IsString()
  @MaxLength(40)
  planCode!: string;

  @IsEnum(ConBillingCycle)
  cycle!: ConBillingCycle;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsIn(['BANK', 'CASH', 'MPESA', 'OTHER'])
  method!: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  reference?: string;
}
