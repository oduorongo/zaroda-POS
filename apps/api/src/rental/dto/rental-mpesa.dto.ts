import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Send an M-Pesa prompt to a tenant's phone. */
export class RequestPaymentDto {
  @IsUUID()
  leaseId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(500000)
  amount!: number;

  // Defaults to the tenant's phone number on file.
  @IsString()
  @MaxLength(20)
  @IsOptional()
  phone?: string;

  // Pay this invoice first when the prompt is started from one.
  @IsUUID()
  @IsOptional()
  invoiceId?: string;
}
