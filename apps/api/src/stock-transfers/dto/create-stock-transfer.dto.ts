import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateStockTransferDto {
  /** Client-generated idempotency key (DESIGN.md §6) - resubmitting the same clientId returns the original transfer instead of erroring or moving stock twice. */
  @IsUUID()
  clientId!: string;

  @IsUUID()
  fromBranchId!: string;

  @IsUUID()
  toBranchId!: string;

  @IsUUID()
  variantId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
