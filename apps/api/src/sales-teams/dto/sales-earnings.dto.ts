import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class EarningsMonthQueryDto {
  @IsOptional()
  @Matches(MONTH, { message: 'Month must look like 2026-10' })
  month?: string;
}

/** The admin recording a payment they made by hand (M-Pesa app, bank, cash). */
export class ManualPayoutDto {
  @IsUUID()
  agentId!: string;

  // Only what was earned up to and including this month is paid; leave out for everything payable.
  @IsOptional()
  @Matches(MONTH, { message: 'Month must look like 2026-10' })
  throughMonth?: string;

  @IsString()
  @MinLength(2, { message: 'Enter the payment reference' })
  @MaxLength(100)
  reference!: string;
}

export class SendPayoutDto {
  @IsUUID()
  agentId!: string;
}

export class ResolvePayoutDto {
  @IsIn(['PAID', 'FAILED'])
  outcome!: 'PAID' | 'FAILED';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class PayoutsQueryDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

/** Rates are fractions: 0.1 = 10%. */
export class UpdatePayoutSettingsDto {
  @IsOptional()
  @IsIn(['MANUAL', 'MPESA_B2C', 'TUMA'])
  payoutGateway?: 'MANUAL' | 'MPESA_B2C' | 'TUMA';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  payoutMinKes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  payoutDay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  holdDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  withholdingTaxRate?: number;
}

/** A refund after earnings accrued: reverses that part of what the member and leader earned from the payment. */
export class RecordSalesAdjustmentDto {
  // The commission invoice or subscription payment the earnings came from.
  @IsUUID()
  sourceId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000_000)
  refundedKes!: number;

  // Makes the call safe to repeat (e.g. the refund's own id).
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** Where a person is paid. A phone number for M-Pesa B2C and TUMA. */
export class UpdatePayoutDetailsDto {
  @IsOptional()
  @IsIn(['MPESA_B2C', 'TUMA', null])
  payoutGateway?: 'MPESA_B2C' | 'TUMA' | null;

  @IsOptional()
  @Matches(/^(\+?254|0)\d{9}$/, { message: 'Enter a Kenyan phone number, e.g. 0712 345 678' })
  payoutAccount?: string;
}
