import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
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

// ── Rooms and housekeeping ────────────────────────────────────────────────

export class CreateRoomDto {
  @IsUUID()
  roomTypeId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  number!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  notes?: string;

  /** Left out, the first branch is used. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class BulkRoomsDto {
  @IsUUID()
  roomTypeId!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Put in front of every number, e.g. "A" for A1, A2... */
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{0,10}$/, {
    message: 'The prefix can only have letters, numbers and hyphens',
  })
  prefix?: string;

  @IsInt()
  @Min(0)
  @Max(99999)
  from!: number;

  @IsInt()
  @Min(0)
  @Max(99999)
  to!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  floor?: string;
}

export class UpdateRoomDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  number?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  notes?: string;

  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetRoomStatusDto {
  @IsIn(['VACANT_CLEAN', 'VACANT_DIRTY', 'OUT_OF_ORDER'])
  status!: 'VACANT_CLEAN' | 'VACANT_DIRTY' | 'OUT_OF_ORDER';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

// ── Payments and the folio ────────────────────────────────────────────────

export class PostPaymentDto {
  @IsIn(['CASH', 'MPESA_RECEIPT', 'CARD'])
  method!: 'CASH' | 'MPESA_RECEIPT' | 'CARD';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  /** The M-Pesa receipt code or the card slip number. Required for M-Pesa. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;
}

export class PostChargeDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount!: number;
}

export class AdjustmentDto {
  /** Negative takes money off (a discount); positive adds. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-10_000_000)
  @Max(10_000_000)
  amount!: number;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class RefundDto {
  @IsIn(['CASH', 'MPESA_RECEIPT', 'CARD'])
  method!: 'CASH' | 'MPESA_RECEIPT' | 'CARD';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

// ── Front-desk bookings ───────────────────────────────────────────────────

export class DepositDto {
  @IsIn(['CASH', 'MPESA_RECEIPT', 'CARD'])
  method!: 'CASH' | 'MPESA_RECEIPT' | 'CARD';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  reference?: string;
}

export class CreateFrontDeskBookingDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  guestName!: string;

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
  @MaxLength(30)
  idNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @IsInt()
  @Min(1)
  @Max(40)
  guests!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rooms?: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Check-in must be a date like 2026-11-05',
  })
  checkIn!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Check-out must be a date like 2026-11-07',
  })
  checkOut!: string;

  @IsUUID()
  roomTypeId!: string;

  /** A particular room, when the guest asks for one (one room per booking). */
  @IsOptional()
  @IsUUID()
  roomId?: string;

  /** A rate other than the room type's price per night. Only a manager or owner may set it. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  rate?: number;

  @IsOptional()
  @IsIn(['FRONT_DESK', 'PHONE'])
  source?: 'FRONT_DESK' | 'PHONE';

  @IsOptional()
  @ValidateNested()
  @Type(() => DepositDto)
  deposit?: DepositDto;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ── The stay ──────────────────────────────────────────────────────────────

export class CheckInDto {
  /** The room(s) the guest goes into: as many as the booking has rooms. Each must be vacant and clean, of the booked type. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUUID(undefined, { each: true })
  roomIds!: string[];

  /** A manager can let a guest in before the arrival date. */
  @IsOptional()
  @IsBoolean()
  overrideEarly?: boolean;
}

export class MoveRoomDto {
  @IsUUID()
  fromRoomId!: string;

  @IsUUID()
  toRoomId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class CheckOutDto {
  /** Payments taken at the desk as part of checking out. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PostPaymentDto)
  payments?: PostPaymentDto[];

  /** A manager or owner can check a guest out leaving a balance (or an overpayment), with the reason. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  leaveBalanceReason?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  /** For a booking with no physical room assigned: which branch the sale is recorded at. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class BookingsQueryDto {
  @IsOptional()
  @IsIn(['arrivals', 'in-house', 'departures'])
  list?: 'arrivals' | 'in-house' | 'departures';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
