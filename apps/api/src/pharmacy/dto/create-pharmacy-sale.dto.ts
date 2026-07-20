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
import { PrescriptionInputDto } from './prescription-input.dto';

/**
 * Same shape as core's CreateSaleDto (reused directly, this module
 * imports from core, never the reverse), plus an optional `prescription`
 * block. `branchId` IS required here (unlike the restaurant module's
 * table-scoped DTO, a pharmacy sale has no table to derive it from).
 */
export class CreatePharmacySaleDto {
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

  @IsInt()
  @IsPositive()
  @IsOptional()
  redeemPoints?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrescriptionInputDto)
  prescription?: PrescriptionInputDto;
}
