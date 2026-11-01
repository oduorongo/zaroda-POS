import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const STATUSES = ['WAITING', 'ACCEPTED', 'DISMISSED'] as const;

export class PurchaseListQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
}

export class PurchaseLineMatchDto {
  @IsInt()
  @Min(1)
  itemSeq!: number;

  /** Our product that this line of the supplier's invoice is. */
  @IsUUID()
  variantId!: string;
}

export class AcceptPurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineMatchDto)
  lines!: PurchaseLineMatchDto[];

  /** The delivery this invoice is for, if it has been received. */
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;
}
