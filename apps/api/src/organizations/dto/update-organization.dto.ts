import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  // KRA PIN format (e.g. P051234567X) isn't validated server-side - format
  // rules occasionally change and a tenant's back office shouldn't hard-
  // reject a value KRA itself would accept; MaxLength just guards against
  // garbage input.
  @IsString()
  @MaxLength(20)
  @IsOptional()
  kraPin?: string;

  @IsBoolean()
  @IsOptional()
  vatRegistered?: boolean;

  // The business details printed at the top of invoices, delivery notes and receipts.
  @IsString()
  @MaxLength(300)
  @IsOptional()
  address?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  email?: string;

  /** A line at the bottom of invoices, e.g. bank details or terms of payment. */
  @IsString()
  @MaxLength(500)
  @IsOptional()
  invoiceFooter?: string;
}
