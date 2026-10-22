import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
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

const PHONE_MESSAGE = 'Enter a valid Kenyan mobile number, e.g. 0712 345 678';

// ── Schools (the supplier's customers) ────────────────────────────────────

export class CreateSchoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  contactName?: string;

  /** The contact person's number: it is also their sign-in on the school portal. */
  @IsString()
  @MaxLength(20, { message: PHONE_MESSAGE })
  phone!: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  county?: string;

  /** Leave out for no limit. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  @IsOptional()
  creditLimit?: number;

  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  creditDays?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class UpdateSchoolDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  contactName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  county?: string;

  /** Send null to remove the limit. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  @IsOptional()
  creditLimit?: number | null;

  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  creditDays?: number;

  @IsIn(['ACTIVE', 'SUSPENDED'])
  @IsOptional()
  status?: 'ACTIVE' | 'SUSPENDED';

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

// ── The price list ────────────────────────────────────────────────────────

export class PriceListEntryDto {
  @IsUUID()
  variantId!: string;

  @IsBoolean()
  @IsOptional()
  onSchoolList?: boolean;

  /** The price schools pay (before VAT). Send null to use the normal price. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  schoolPrice?: number | null;
}

export class SavePriceListDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PriceListEntryDto)
  entries!: PriceListEntryDto[];
}

// ── The portal's address ──────────────────────────────────────────────────

export class SavePortalDto {
  @IsString()
  @MaxLength(60)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

// ── Orders, from the school's side and the supplier's ─────────────────────

export class OrderLineInputDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;
}

export class SubmitSchoolOrderDto {
  /** The school's own order number (LPO). */
  @IsString()
  @IsOptional()
  @MaxLength(50)
  lpoNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  deliveryAddress?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  requestedDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];
}

export class CancelOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class LineQuantityDto {
  @IsUUID()
  lineId!: string;

  /** The quantity the supplier can supply (0 = cannot supply this line). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  quantity!: number;
}

export class ConfirmOrderDto {
  /** Leave out to confirm exactly what was ordered. */
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineQuantityDto)
  @IsOptional()
  lines?: LineQuantityDto[];

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

export class DeliverOrderDto {
  @IsUUID()
  branchId!: string;

  /** The person at the school who received the goods. */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  receivedByName!: string;

  /** Leave out to deliver exactly what was confirmed. */
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineQuantityDto)
  @IsOptional()
  lines?: LineQuantityDto[];

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

// ── Payments ──────────────────────────────────────────────────────────────

export class AllocationDto {
  @IsUUID()
  invoiceId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

export class RecordPaymentDto {
  @IsUUID()
  schoolId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000_000)
  amount!: number;

  @IsIn(['CHEQUE', 'BANK_TRANSFER', 'MPESA', 'CASH'])
  method!: 'CHEQUE' | 'BANK_TRANSFER' | 'MPESA' | 'CASH';

  /** The cheque number, bank reference or M-Pesa code. */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  bankName?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  chequeDate?: string;

  /** The day the money was received; today if left out. */
  @IsDateString({ strict: true })
  @IsOptional()
  receivedOn?: string;

  /** Which invoices it pays. Left out, the oldest invoice is paid first. */
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  @IsOptional()
  allocations?: AllocationDto[];

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class BouncePaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class VoidInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class ListQueryDto {
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z_]+$/)
  status?: string;

  @IsUUID()
  @IsOptional()
  schoolId?: string;
}

export class StatementQueryDto {
  @IsDateString({ strict: true })
  @IsOptional()
  from?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  to?: string;
}

// ── The school portal's own sign-in ───────────────────────────────────────

export class SchoolLoginDto {
  @IsString()
  @MaxLength(60)
  slug!: string;

  @IsString()
  @MaxLength(20)
  phone!: string;

  @Matches(/^\d{4,6}$/, { message: 'Your PIN is 4 to 6 digits' })
  pin!: string;
}
