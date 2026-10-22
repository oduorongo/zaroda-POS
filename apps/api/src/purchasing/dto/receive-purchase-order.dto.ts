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

  /** The good quantity that goes into stock (0 when the whole line was damaged). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
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

  /** How much of the delivery arrived broken, expired or wrong: not put into stock, kept on the receipt for a claim. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @IsOptional()
  damaged?: number;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  damagedNote?: string;

  // What was actually paid per unit on this delivery. Left out, the price on the order is used.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  unitCost?: number;
}

export class ReceiveBillDto {
  /** The supplier's invoice number (the delivery note number is used if this is left out). */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  billNumber?: string;

  @IsDateString()
  @IsOptional()
  billDate?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class ReceivePurchaseOrderDto {
  /** The supplier's delivery note or invoice number. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  deliveryNote?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  /** Also record what is now owed to the supplier for what was accepted. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiveBillDto)
  bill?: ReceiveBillDto;

  /** Warn when the margin on a received product falls under this percent (10 if left out). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  minMarginPercent?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderLineDto)
  lines!: ReceivePurchaseOrderLineDto[];
}
