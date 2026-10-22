import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpsertRoomTypeDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1500)
  description?: string;

  /** Comma-separated, e.g. "WiFi, Breakfast included, Hot shower". */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(400)
  amenities?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  pricePerNight!: number;

  @IsInt()
  @Min(1)
  @Max(20)
  maxGuests!: number;

  @IsInt()
  @Min(1)
  @Max(500)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  depositPercent!: number;

  @IsOptional()
  @IsBoolean()
  isListed?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CancelBookingDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

/** A guest booking a room from the marketplace - no account, a phone number to pay the deposit with. */
export class CreateBookingDto {
  @IsUUID()
  roomTypeId!: string;

  /** YYYY-MM-DD */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Choose your check-in date' })
  checkIn!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Choose your check-out date' })
  checkOut!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rooms!: number;

  @IsInt()
  @Min(1)
  @Max(40)
  guests!: number;

  /** How many of the guests are children (the rest are adults). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(39)
  children?: number;

  @IsOptional()
  @IsIn(['ROOM_ONLY', 'BED_BREAKFAST', 'HALF_BOARD', 'FULL_BOARD'])
  mealPlan?: 'ROOM_ONLY' | 'BED_BREAKFAST' | 'HALF_BOARD' | 'FULL_BOARD';

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** The M-Pesa number that gets the deposit prompt; the hotel also uses it to reach the guest. */
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** The secret the guest's browser was given when the booking was made. */
export class GuestBookingTokenDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class ConfirmBookingPaymentDto {
  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  receipt!: string;
}

/** Why ZARODA is taking a hotel off the marketplace - shown to the hotel. */
export class BlockHotelDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

/** Why ZARODA is switching off table ordering for a business - shown to the restaurant. */
export class BlockTableOrderingDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
