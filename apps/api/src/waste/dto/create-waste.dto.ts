import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { WasteReason } from '@prisma/client';

export class CreateWasteDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  variantId!: string;

  // Whole or fractional depending on the variant's QuantityMode (or, for a
  // recipe-tracked variant, checked per-ingredient in WasteService).
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @IsEnum(WasteReason)
  reason!: WasteReason;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  // Only meaningful for a plain stocked item - which specific delivery
  // batch is being written off. Ignored (rejected, see WasteService) for
  // a recipe-tracked variant, which has no batches of its own.
  @IsUUID()
  @IsOptional()
  batchId?: string;
}
