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
import { PaymentMethod } from '@prisma/client';

export class SaleLineItemInputDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class SalePaymentInputDto {
  // Only CASH actually completes a sale in this increment - see
  // SalesService.create()'s comment on why M-Pesa/card are rejected here
  // rather than silently mishandled.
  @IsIn(['CASH'] satisfies PaymentMethod[])
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  phoneNumber?: string;
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
}
