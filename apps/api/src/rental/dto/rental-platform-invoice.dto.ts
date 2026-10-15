import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PayPlatformInvoiceDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class ListPlatformInvoicesQueryDto {
  @IsIn(['ISSUED', 'PAID', 'WAIVED'])
  @IsOptional()
  status?: 'ISSUED' | 'PAID' | 'WAIVED';

  @IsUUID()
  @IsOptional()
  organizationId?: string;
}

export class RecordPlatformInvoicePaymentDto {
  @IsIn(['MPESA', 'BANK', 'CASH'])
  method!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  reference?: string;
}

export class WaivePlatformInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
