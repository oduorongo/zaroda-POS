import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { DiscountType, PaymentMethod } from '@prisma/client';

export class SaleLineItemInputDto {
  @IsUUID()
  variantId!: string;

  // Whole or fractional depending on the variant's QuantityMode (COUNT vs
  // WEIGHT) - checked against the actual variant server-side in
  // SalesService, since that's the only place that knows which mode this
  // variantId is in. maxDecimalPlaces caps precision at 3 (gram-level for
  // a kg-priced item) regardless of mode.
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  // Which batch this line was drawn from - core capability (batch/expiry
  // tracking isn't pharmacy-exclusive, see schema.prisma's Batch model
  // comment), optional since most retail sales don't track batches at
  // all. Validated to exist and belong to this variant in
  // InventoryTransactionsService.recordInTx, same as every other batchId
  // use in this codebase. A vertical module (e.g. pharmacy) can subscribe
  // to inventory.beforeDecrement to enforce rules against the batch this
  // carries (expiry, controlled-substance flags) without core needing to
  // know what those rules are.
  @IsUUID()
  @IsOptional()
  batchId?: string;
}

export class SalePaymentInputDto {
  // CARD/WALLET still rejected - see SalesService.create()'s comment.
  // MPESA is only accepted when providerReference names an already-SUCCESS
  // MpesaStkRequest (verified server-side, never trusted from the client).
  @IsIn(['CASH', 'MPESA'] satisfies PaymentMethod[])
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  // Required when method is MPESA - the checkoutRequestId from
  // POST /payments/mpesa/initiate. Cross-checked against MpesaStkRequest in
  // SalesService.create().
  @IsString()
  @IsOptional()
  providerReference?: string;
}

export class DiscountInputDto {
  @IsIn(['PERCENT', 'FIXED'] satisfies DiscountType[])
  type!: DiscountType;

  // PERCENT is a 0-100 rate (upper bound checked in SalesService, since the
  // valid range depends on `type`); FIXED is an absolute amount in
  // org.baseCurrency, checked there against the sale total - a fixed
  // discount larger than the ticket is rejected, not clamped silently.
  @IsNumber()
  @Min(0.01)
  value!: number;

  // The OrgUser who authorized this discount - must independently hold
  // SUPERVISOR/MANAGER/OWNER in this org (verified server-side against the
  // database, never trusted from the client) so a cashier can't grant
  // their own discount by simply passing their own id.
  @IsUUID()
  approvedById!: string;
}

export class CreateSaleDto {
  /** Client-generated idempotency key (DESIGN.md §6) - resubmitting the same clientId returns the original sale instead of erroring or duplicating it. */
  @IsUUID()
  clientId!: string;

  @IsUUID()
  branchId!: string;

  @IsUUID()
  terminalId!: string;

  @IsUUID()
  cashierSessionId!: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleLineItemInputDto)
  lineItems!: SaleLineItemInputDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentInputDto)
  payments!: SalePaymentInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountInputDto)
  discount?: DiscountInputDto;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  // Points to redeem toward this sale - requires customerId, checked in
  // SalesService rather than here since class-validator's cross-field
  // rules would obscure this simple a check.
  @IsInt()
  @IsPositive()
  @IsOptional()
  redeemPoints?: number;
}
