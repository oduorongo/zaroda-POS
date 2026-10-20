import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReceivePurchaseOrderLineDto {
  @IsUUID()
  lineItemId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  // Present only when this receipt should be batch/expiry-tracked - same
  // optionality as the ad-hoc receiving flow (BatchesService.create).
  @IsString()
  @IsOptional()
  @MaxLength(100)
  batchNumber?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  // What was actually paid per unit on this delivery. Left out, the price on the order is used.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  unitCost?: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderLineDto)
  lines!: ReceivePurchaseOrderLineDto[];
}
