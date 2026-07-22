import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBatchDto {
  @IsUUID()
  variantId!: string;

  // Which branch physically received this batch - Batch itself has no
  // branchId column (a batch record describes the goods, not where they
  // are), but receiving one always happens at a specific branch, so the
  // corresponding inventory increment needs one.
  @IsUUID()
  branchId!: string;

  @IsString()
  @MaxLength(100)
  batchNumber!: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantityReceived!: number;
}
