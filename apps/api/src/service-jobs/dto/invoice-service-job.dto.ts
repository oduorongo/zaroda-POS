import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  DiscountInputDto,
  SaleLineItemInputDto,
  SalePaymentInputDto,
} from '../../sales/dto/create-sale.dto';

/**
 * Same shape as core's CreateSaleDto minus `branchId` (derived from the
 * job), same reasoning as CheckoutAppointmentDto. `lineItems` reuses core's
 * plain SaleLineItemInputDto unchanged - both parts and labor are billed as
 * catalog ProductVariants (a "Labor" service item priced per hour, with
 * quantity = hours billed), so no separate part/labor line-item model is
 * needed here.
 */
export class InvoiceServiceJobDto {
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

  @IsInt()
  @IsPositive()
  @IsOptional()
  redeemPoints?: number;
}
