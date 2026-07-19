import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  NotEquals,
} from 'class-validator';
import { InventoryTxnType } from '@prisma/client';

export class CreateInventoryTransactionDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  variantId!: string;

  @IsEnum(InventoryTxnType)
  type!: InventoryTxnType;

  /** Signed - e.g. -3 for a sale of 3 units, +50 for a delivery received. */
  @IsInt()
  @NotEquals(0)
  quantityDelta!: number;

  @IsUUID()
  @IsOptional()
  batchId?: string;

  /** Loosely-typed pointer to the originating sale/transfer/stocktake row - see schema.prisma's note on InventoryTransaction. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  referenceId?: string;
}
