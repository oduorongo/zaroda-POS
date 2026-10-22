import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateProductDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
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

  // Online Shop add-on - see Product.onlineVisible's schema comment.
  @IsBoolean()
  @IsOptional()
  onlineVisible?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  onlineDescription?: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
