import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { STAY_PAYMENT_METHODS, STAY_SOURCES } from './stays.util';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class StayUnitDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) nightlyRate!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) weekendRate?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) minNights?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxGuests?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cleaningFee?: number;
  @IsOptional() @Matches(TIME, { message: 'Use a time like 14:00' }) checkInTime?: string;
  @IsOptional() @Matches(TIME, { message: 'Use a time like 10:00' }) checkOutTime?: string;
  @IsOptional() @IsString() @MaxLength(500) directions?: string | null;
  @IsOptional() @IsString() @MaxLength(40) doorCode?: string | null;
  @IsOptional() @IsString() @MaxLength(80) cleanerName?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cleanerPhone?: string | null;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class OwnerDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string | null;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) commissionPercent?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class StayDto {
  @IsUUID() unitId!: string;
  @IsOptional() @IsIn(STAY_SOURCES) source?: (typeof STAY_SOURCES)[number];
  @IsOptional() @IsString() @MaxLength(60) externalRef?: string | null;
  @IsString() @MinLength(2) @MaxLength(120) guestName!: string;
  @IsOptional() @IsString() @MaxLength(20) guestPhone?: string | null;
  @IsOptional() @IsEmail() guestEmail?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(50) guests?: number;
  @IsDateString() checkIn!: string;
  @IsDateString() checkOut!: string;
  /** Leave out to use the unit's rates; type it for a booking priced on Airbnb / Booking.com. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) accommodation?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cleaningFee?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) channelFee?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class StayChangeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) guestName?: string;
  @IsOptional() @IsString() @MaxLength(20) guestPhone?: string | null;
  @IsOptional() @IsEmail() guestEmail?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(50) guests?: number;
  @IsOptional() @IsDateString() checkIn?: string;
  @IsOptional() @IsDateString() checkOut?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) accommodation?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cleaningFee?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) channelFee?: number;
  @IsOptional() @IsString() @MaxLength(60) externalRef?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class StayCancelDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class StayPaymentDto {
  @IsOptional() @IsIn(['PAYMENT', 'REFUND']) kind?: 'PAYMENT' | 'REFUND';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount!: number;
  @IsIn(STAY_PAYMENT_METHODS) method!: (typeof STAY_PAYMENT_METHODS)[number];
  @IsOptional() @IsString() @MaxLength(60) reference?: string | null;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

export class StayVoidDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class StayBlockDto {
  @IsUUID() unitId!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() @MaxLength(200) summary?: string | null;
}

export class StayFeedDto {
  @IsIn(['AIRBNB', 'BOOKING_COM', 'OTHER']) source!: 'AIRBNB' | 'BOOKING_COM' | 'OTHER';
  @IsString() @MaxLength(1000) url!: string;
}

export class CleaningDto {
  @IsUUID() unitId!: string;
  @IsDateString() dueDate!: string;
  @IsOptional() @IsString() @MaxLength(80) cleanerName?: string | null;
  @IsOptional() @IsString() @MaxLength(20) cleanerPhone?: string | null;
  @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

export class CleaningDoneDto {
  @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

export class StayCalendarQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(62) days?: number;
}

export class StayListQueryDto {
  @IsOptional() @IsIn(['upcoming', 'current', 'past', 'cancelled', 'all']) view?: 'upcoming' | 'current' | 'past' | 'cancelled' | 'all';
  @IsOptional() @IsUUID() unitId?: string;
}

export class StatementQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use a month like 2026-11' }) month!: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsIn(['csv']) format?: 'csv';
}

export class StayTextsDto {
  @IsBoolean() stayTexts!: boolean;
}
