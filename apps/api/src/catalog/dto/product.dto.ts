import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  taxClassId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  baseUnit?: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
