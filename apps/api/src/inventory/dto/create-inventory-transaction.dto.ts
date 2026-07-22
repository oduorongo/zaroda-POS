import {
  IsEnum,
  IsNumber,
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

  /** Signed - e.g. -3 for a sale of 3 units, +50 for a delivery received. Whole or fractional depending on the variant's QuantityMode - checked in InventoryTransactionsService, the only place that knows the variant's mode. */
  @IsNumber({ maxDecimalPlaces: 3 })
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
