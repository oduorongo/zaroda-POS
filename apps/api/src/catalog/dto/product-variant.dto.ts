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
}

export class UpdateProductVariantDto extends PartialType(
  CreateProductVariantDto,
) {}
