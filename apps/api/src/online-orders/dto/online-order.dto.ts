import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
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
import { FulfilmentType, OnlineOrderStatus } from '@prisma/client';

// Exactly one of email / phone - checked in BuyerAuthService so the message can
// say so plainly.
export class RequestBuyerCodeDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;
}

export class VerifyBuyerCodeDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @Matches(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code from the SMS' })
  code!: string;
}

export class UpdateBuyerDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
}

export class OrderLineDto {
  @IsUUID()
  variantId!: string;

  // Whole or fractional depending on the variant's QuantityMode - checked
  // in the service, the only place that knows the variant's mode.
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  /** What the buyer asked for on this dish, e.g. "no onions". Shown on the kitchen ticket. */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  note?: string;
}

export class CreateOnlineOrderDto {
  @IsString()
  @MaxLength(60)
  shopSlug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @IsEnum(FulfilmentType)
  fulfilmentType!: FulfilmentType;

  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(500)
  deliveryAddress?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  buyerName?: string;

  // Defaults to the buyer's login phone - lets someone else's M-Pesa pay.
  @IsString()
  @IsOptional()
  @MaxLength(20)
  paymentPhone?: string;
}

export class RetryPaymentDto {
  @IsString()
  @IsOptional()
  @MaxLength(20)
  paymentPhone?: string;
}

export class CancelOnlineOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class ConfirmOrderPaymentDto {
  // The M-Pesa confirmation code from the SMS (e.g. SJK1ABC2DE) - kept so the
  // payment can be traced, and unique across orders.
  @IsString()
  @Matches(/^[A-Za-z0-9]{8,20}$/, { message: 'Enter the M-Pesa code from the confirmation message, e.g. SJK1ABC2DE' })
  receipt!: string;
}

export class ListOnlineOrdersQueryDto {
  @IsIn(Object.values(OnlineOrderStatus))
  @IsOptional()
  status?: OnlineOrderStatus;
}

/** A diner at a table, ordering from the table's QR code. No account - just a phone number to pay with. */
export class CreateTableOrderDto {
  @IsString()
  @MaxLength(60)
  shopSlug!: string;

  @IsUUID()
  tableId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  /** The M-Pesa number that gets the payment prompt. */
  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;

  /** A tip for the staff, in whole shillings. Paid in the same M-Pesa prompt as the order. */
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(10000)
  tipAmount?: number;
}

/** The secret the diner's browser was given when the order was placed. */
export class GuestTokenDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;
}
