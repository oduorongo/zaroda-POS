import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  /** Days after a bill's date that it falls due. */
  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  paymentTermsDays?: number;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
