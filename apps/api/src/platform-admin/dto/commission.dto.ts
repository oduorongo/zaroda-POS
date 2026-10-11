import { CommissionInvoiceStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const METHODS = ['MPESA', 'BANK', 'CASH'] as const;

export class GenerateInvoicesDto {
  // "2026-10". Omitted = every finished month that has unbilled orders.
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Month must look like 2026-10' })
  @IsOptional()
  month?: string;
}

export class ListInvoicesQueryDto {
  @IsEnum(CommissionInvoiceStatus)
  @IsOptional()
  status?: CommissionInvoiceStatus;

  @IsUUID()
  @IsOptional()
  organizationId?: string;
}

export class RecordInvoicePaymentDto {
  @IsIn(METHODS)
  method!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  reference?: string;
}

export class WaiveInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
