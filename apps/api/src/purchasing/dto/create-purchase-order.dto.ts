import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseOrderLineDto {
  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantityOrdered!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  supplierId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lineItems!: CreatePurchaseOrderLineDto[];
}
