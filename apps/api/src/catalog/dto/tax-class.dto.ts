import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTaxClassDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /** Decimal fraction, e.g. 0.16 for 16% VAT. */
  @IsNumber()
  @Min(0)
  @Max(1)
  rate!: number;

  @IsBoolean()
  @IsOptional()
  isExempt?: boolean;
}

export class UpdateTaxClassDto extends PartialType(CreateTaxClassDto) {}
