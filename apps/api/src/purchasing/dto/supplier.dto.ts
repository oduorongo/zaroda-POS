import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
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

  /** The supplier's KRA PIN, so their eTIMS invoices to us can be matched. Empty clears it. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/\s+/g, '').toUpperCase() || null
      : value,
  )
  @IsOptional()
  @Matches(/^[AP]\d{9}[A-Z]$/, { message: 'A KRA PIN is a letter, nine digits and a letter, like A123456789Z' })
  kraPin?: string | null;

  /** Days after a bill's date that it falls due. */
  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  paymentTermsDays?: number;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
