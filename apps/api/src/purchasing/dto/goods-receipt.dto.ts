import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReceiveBillDto } from './receive-purchase-order.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GoodsReceiptLineDto {
  /** The product - needed when the delivery is not against a purchase order. */
  @IsUUID()
  @IsOptional()
  variantId?: string;

  /** The purchase-order line this delivery is for - needed when it is against a purchase order. */
  @IsUUID()
  @IsOptional()
  lineItemId?: string;

  /** The good quantity that goes into stock (0 if everything on the line was damaged). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @IsOptional()
  damaged?: number;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(300)
  damagedNote?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  @IsOptional()
  unitCost?: number;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  batchNumber?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}

/** Stock arriving - against a purchase order or without one - in one atomic receipt. */
export class CreateGoodsReceiptDto {
  /** Needed when there is no purchase order (the order says where it goes otherwise). */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  purchaseOrderId?: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  deliveryNote?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiveBillDto)
  bill?: ReceiveBillDto;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  minMarginPercent?: number;
}
