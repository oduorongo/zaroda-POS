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
 * Same shape as core's CreateSaleDto, minus `branchId` (derived from the
 * appointment, same reasoning as the restaurant module's table-scoped
 * order DTO). `lineItems` reuses core's plain SaleLineItemInputDto
 * unchanged - checkout needs a real catalog price to charge, unlike
 * SalonAppointment.serviceName which stays free text for this vertical.
 */
export class CheckoutAppointmentDto {
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
}
