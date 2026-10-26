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

  /** A share of each invoice the school holds back until released, in percent (0 = none). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @IsOptional()
  retentionPercent?: number;

  /** How many days after an invoice the retention is expected to be released. */
  @IsInt()
  @Min(0)
  @Max(1825)
  @IsOptional()
  retentionReleaseDays?: number;

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

  /** A share of each invoice the school holds back until released, in percent (0 = none). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @IsOptional()
  retentionPercent?: number;

  /** How many days after an invoice the retention is expected to be released. */
  @IsInt()
  @Min(0)
  @Max(1825)
  @IsOptional()
  retentionReleaseDays?: number;

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

/** Ticking (or un-ticking) that the school's LPO was received and checked against its signed copy. */
export class LpoCheckDto {
  @IsBoolean()
  checked!: boolean;
}

// ── Retention ─────────────────────────────────────────────────────────────

export class RetentionReleaseDto {
  /** How much becomes due now. Left out, everything still held. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

export class RetentionUpdateDto {
  /** When the retention is expected to be released. null clears it. */
  @IsDateString({ strict: true })
  @IsOptional()
  expectedReleaseDate?: string | null;

  @IsBoolean()
  @IsOptional()
  disputed?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  disputeNote?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string | null;
}

export class RetentionRequestDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

// ── Chasing unpaid invoices ───────────────────────────────────────────────

export class FollowUpDto {
  /** When the school promised to pay. null clears it. */
  @IsDateString()
  @IsOptional()
  expectedPaymentDate?: string | null;

  @IsBoolean()
  @IsOptional()
  disputed?: boolean;

  /** What the school disputes. Needed when disputed. */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  disputeNote?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string | null;

  /** The member of staff chasing it (an OrgUser id). An empty text clears it. */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  responsibleId?: string | null;
}

// ── Tenders and contracts ─────────────────────────────────────────────────

export class SaveTenderDto {
  /** A school the business already sells to, when the tender is from one. */
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  /** The institution inviting the tender. */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  entityName!: string;

  /** The institution's own tender reference. */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  tenderNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsDateString({ strict: true })
  @IsOptional()
  closingDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class TenderLineDto {
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  /** What it costs the business. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  unitCost!: number;

  /** The price offered, before VAT. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  unitPrice!: number;

  /** VAT as a fraction (0.16); 0 when exempt. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  @IsOptional()
  taxRate?: number;
}

export class SaveTenderLinesDto {
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => TenderLineDto)
  lines!: TenderLineDto[];
}

export class ChecklistItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;
}

export class ChecklistTickDto {
  @IsBoolean()
  done!: boolean;
}

export class SubmitTenderDto {
  /** Needed to submit in spite of something that blocks it (an expired document, an unticked item): why it is all right. */
  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(300)
  overrideReason?: string;
}

export class AwardTenderDto {
  /** The school the contract is with (needed when the tender did not name one). */
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  /** Left out, the bid amount is used. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000_000)
  @IsOptional()
  value?: number;

  /** A share of each invoice the school holds back until released, in percent (0 = none). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @IsOptional()
  retentionPercent?: number;

  /** How many days after an invoice the retention is expected to be released. */
  @IsInt()
  @Min(0)
  @Max(1825)
  @IsOptional()
  retentionReleaseDays?: number;

  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class TenderOutcomeDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

export class ComplianceDocDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  reference?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  issuedOn?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  expiryDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class SaveContractDto {
  @IsUUID()
  schoolId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  /** The institution's own contract reference. */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;

  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;

  /** The value agreed, VAT included. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000_000)
  value!: number;

  /** A share of each invoice the school holds back until released, in percent (0 = none). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @IsOptional()
  retentionPercent?: number;

  /** How many days after an invoice the retention is expected to be released. */
  @IsInt()
  @Min(0)
  @Max(1825)
  @IsOptional()
  retentionReleaseDays?: number;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateContractDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  reference?: string;

  /** A share of each invoice the school holds back until released, in percent (0 = none). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @IsOptional()
  retentionPercent?: number;

  /** How many days after an invoice the retention is expected to be released. */
  @IsInt()
  @Min(0)
  @Max(1825)
  @IsOptional()
  retentionReleaseDays?: number;

  @IsDateString({ strict: true })
  @IsOptional()
  startDate?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class VariationDto {
  /** A change to the contract value, VAT included: plus for more, minus for less. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-10_000_000_000)
  @Max(10_000_000_000)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;

  @IsDateString({ strict: true })
  @IsOptional()
  date?: string;
}

export class CloseContractDto {
  @IsIn(['COMPLETED', 'TERMINATED'])
  outcome!: 'COMPLETED' | 'TERMINATED';

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  note!: string;
}

export class OrderContractDto {
  /** The contract the order is supplied under; null takes it off. */
  @IsUUID()
  @IsOptional()
  contractId?: string | null;
}

// ── Quotations ────────────────────────────────────────────────────────────

export class QuoteLineInputDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  /** Left out, the school's price from the price list is used. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  unitPrice?: number;
}

export class SaveQuoteDto {
  @IsUUID()
  schoolId!: string;

  /** Left out, the quotation is open for 30 days from the day it is issued. */
  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  terms?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineInputDto)
  lines!: QuoteLineInputDto[];
}

/** Accepting a quotation: the order it becomes may carry the school's own LPO number. */
export class AcceptQuoteDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  lpoNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  deliveryAddress?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class DeclineQuoteDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

/** Recording the withholding certificate for a payment of tax withheld (the school sends it afterwards). */
export class CertificateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  certificateNumber!: string;

  /** The day the certificate reached us; today if left out. */
  @IsDateString({ strict: true })
  @IsOptional()
  receivedOn?: string;
}

/** One line of an invoice being credited. */
export class CreditLineDto {
  @IsUUID()
  invoiceLineId!: string;

  /** How many of that line to credit. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;

  /** How many of those came back into stock (leave out when none did). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  restock?: number;
}

export class CreateCreditNoteDto {
  @IsUUID()
  invoiceId!: string;

  @IsIn(['RETURNED', 'DAMAGED', 'SHORT_DELIVERY', 'PRICE_ERROR', 'OTHER'])
  reason!: 'RETURNED' | 'DAMAGED' | 'SHORT_DELIVERY' | 'PRICE_ERROR' | 'OTHER';

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;

  /** The branch the returned goods go back into (needed when any are put back in stock). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreditLineDto)
  lines!: CreditLineDto[];
}

/** Closing an order that was delivered in part, giving up the rest. */
export class CloseBalanceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  note!: string;
}

/** The school saying one delivery arrived. */
export class ConfirmReceiptDto {
  /** Who at the school received the goods. */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
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

  @IsIn(['CHEQUE', 'BANK_TRANSFER', 'MPESA', 'CASH', 'WITHHOLDING_TAX'])
  method!: 'CHEQUE' | 'BANK_TRANSFER' | 'MPESA' | 'CASH' | 'WITHHOLDING_TAX';

  /** For tax withheld by the school: the certificate number, if it has already come. */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  certificateNumber?: string;

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

// ── Bad debts ─────────────────────────────────────────────────────────────

export class BadDebtSettingsDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate1To30!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate31To60!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate61To90!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate91To180!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rateOver180!: number;

  /** A write-off of this much or more needs a second person to approve it (0 = every one does). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  approvalThreshold!: number;
}

export class ProvisionPostDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

export class WriteOffDto {
  @IsUUID()
  invoiceId!: string;

  /** Left out, everything still owed on the invoice. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  @IsOptional()
  amount?: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class WriteOffDecisionDto {
  /** Needed when approving a write-off you asked for yourself (owner only). */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  overrideReason?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class WriteOffReverseDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

// ── Cash-flow forecast ────────────────────────────────────────────────────

export class CashflowQueryDto {
  /** The share of what is expected in that actually arrives. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  collectPercent?: number;

  /** Extra days schools take to pay. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(180)
  @IsOptional()
  delayDays?: number;

  @IsIn(['true', 'false'])
  @IsOptional()
  includeRetention?: string;

  @IsIn(['true', 'false'])
  @IsOptional()
  includePipeline?: string;

  @IsIn(['true', 'false'])
  @IsOptional()
  includeBills?: string;

  @IsIn(['true', 'false'])
  @IsOptional()
  includeDisputed?: string;
}

export class CashflowSettingsDto {
  /** The cash on hand today (bank, M-Pesa and cash together). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000_000)
  openingCash!: number;

  /** The least cash wanted at any time. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  minimumCash!: number;
}

export class CashflowItemDto {
  @IsIn(['IN', 'OUT'])
  direction!: 'IN' | 'OUT';

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  amount!: number;

  @IsDateString({ strict: true })
  date!: string;

  @IsIn(['NONE', 'WEEKLY', 'MONTHLY'])
  @IsOptional()
  repeat?: 'NONE' | 'WEEKLY' | 'MONTHLY';

  @IsDateString({ strict: true })
  @IsOptional()
  repeatUntil?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
