import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FulfilmentType, OnlineOrderStatus } from '@prisma/client';

export class RequestBuyerCodeDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class VerifyBuyerCodeDto {
  @IsString()
  @MaxLength(20)
  phone!: string;

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
