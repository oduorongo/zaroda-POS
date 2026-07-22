import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { QuantityMode } from '@prisma/client';

export class CreateProductVariantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  barcode?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  /** Unit cost - optional, used only by the COGS/margin report (reports/reports.service.ts). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  cost?: number;

  // COUNT (default) = sold/stocked in whole units. WEIGHT = fractional
  // quantities allowed (kg, litre, ...) - see schema.prisma's QuantityMode
  // comment. Enforced against every quantity this variant appears in
  // (sales, inventory, batches, transfers, purchase orders, repackaging).
  @IsEnum(QuantityMode)
  @IsOptional()
  quantityMode?: QuantityMode;
}

export class UpdateProductVariantDto extends PartialType(
  CreateProductVariantDto,
) {}
