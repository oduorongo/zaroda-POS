import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DiscountInputDto,
  SaleLineItemInputDto,
  SalePaymentInputDto,
} from '../../sales/dto/create-sale.dto';

/**
 * Same shape as core's CreateSaleDto (reused directly - this module
 * imports from core, never the reverse, per DESIGN.md §3), minus
 * `branchId`: the table this order is for already implies the branch, so
 * asking the caller to also pass a matching branchId would just be
 * another way for a client bug to send a mismatched one - the service
 * derives it from the table instead.
 */
export class CreateTableSaleDto {
  @IsUUID()
  clientId!: string;

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

  @IsInt()
  @IsPositive()
  @IsOptional()
  redeemPoints?: number;

  // Collected as extra cash alongside the sale's own exact-total
  // payment, never folded into it - see the RestaurantSaleTip schema
  // comment for why.
  @IsNumber()
  @Min(0)
  @IsOptional()
  tipAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  serviceChargeAmount?: number;
}
