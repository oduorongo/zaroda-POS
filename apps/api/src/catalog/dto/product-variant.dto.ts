import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

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
}

export class UpdateProductVariantDto extends PartialType(
  CreateProductVariantDto,
) {}
