import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLANS = [
  'ROOM_ONLY',
  'BED_BREAKFAST',
  'HALF_BOARD',
  'FULL_BOARD',
] as const;

// ── Prices ────────────────────────────────────────────────────────────────

export class RateCardDto {
  /** Price per night on weekend nights; send null to use the base price. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  weekendRate?: number | null;

  /** 0 = Sunday ... 6 = Saturday. */
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekendDays!: number[];

  @IsInt()
  @Min(1)
  @Max(10)
  includedAdults!: number;

  @IsInt()
  @Min(0)
  @Max(10)
  freeChildren!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  extraAdultRate!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  extraChildRate!: number;
}

export class SeasonDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @Matches(DATE, { message: 'The start must be a date like 2026-12-20' })
  startDate!: string;

  @Matches(DATE, { message: 'The end must be a date like 2027-01-05' })
  endDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  rate!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  weekendRate?: number | null;
}

export class MealPriceDto {
  @IsIn(PLANS)
  plan!: (typeof PLANS)[number];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  adultPrice!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  childPrice!: number;
}

export class MealPricesDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => MealPriceDto)
  prices!: MealPriceDto[];
}

// ── The hotel's rules ─────────────────────────────────────────────────────

export class TaxLineDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percent!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TaxesDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaxLineDto)
  taxes!: TaxLineDto[];
}

export class HotelSettingsDto {
  @IsInt()
  @Min(0)
  @Max(365)
  cancelFreeDays!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  cancelKeepPercent!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  nightAuditHour!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  noShowCutoffHour!: number;

  @IsBoolean()
  confirmationSms!: boolean;

  @IsBoolean()
  reminderSms!: boolean;

  @IsBoolean()
  thankYouSms!: boolean;
}

// ── Changing a stay, cancelling ───────────────────────────────────────────

export class AmendBookingDto {
  @IsOptional()
  @Matches(DATE)
  checkIn?: string;

  @IsOptional()
  @Matches(DATE)
  checkOut?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rooms?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  adults?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(40)
  children?: number;

  @IsOptional()
  @IsIn(PLANS)
  mealPlan?: (typeof PLANS)[number];

  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  /** A flat price per room per night for the whole stay. Only a manager or owner may set it. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  rate?: number;

  /** For a guest who is in the house and whose rooms change: the rooms they will be in afterwards (as many as the booking then has). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID(undefined, { each: true })
  roomIds?: string[];

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  /** True = only work out the new price and what would change; save nothing. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class CancelWithPolicyDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;

  /** A manager or owner can cancel without keeping any of the deposit (e.g. the hotel's own fault). */
  @IsOptional()
  @IsBoolean()
  waiveFee?: boolean;
}

export class CancellationRefundDto {
  @IsIn(['CASH', 'MPESA_RECEIPT', 'CARD'])
  method!: 'CASH' | 'MPESA_RECEIPT' | 'CARD';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string;
}

// ── Guests ────────────────────────────────────────────────────────────────

export class GuestLookupDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  idNumber?: string;
}

export class UpdateGuestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  idNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  vehicleReg?: string;

  @IsOptional()
  @IsBoolean()
  smsOptOut?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ── Night audit and reports ───────────────────────────────────────────────

export class NightAuditDto {
  /** The day to close (defaults to today). */
  @IsOptional()
  @Matches(DATE)
  date?: string;
}

export class ReportQueryDto {
  @Matches(DATE)
  from!: string;

  @Matches(DATE)
  to!: string;

  /** For the arrivals / departures / in-house lists. */
  @IsOptional()
  @Matches(DATE)
  date?: string;
}

export class NoShowDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  waiveFee?: boolean;
}

/** "What would this stay cost?" at the desk, before booking. */
export class QuoteDto {
  @IsUUID()
  roomTypeId!: string;

  @Matches(DATE)
  checkIn!: string;

  @Matches(DATE)
  checkOut!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rooms!: number;

  @IsInt()
  @Min(1)
  @Max(40)
  guests!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(39)
  children?: number;

  @IsOptional()
  @IsIn(PLANS)
  mealPlan?: (typeof PLANS)[number];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  rate?: number;
}
