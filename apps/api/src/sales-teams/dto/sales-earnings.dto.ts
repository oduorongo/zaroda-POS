import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class EarningsMonthQueryDto {
  @IsOptional()
  @Matches(MONTH, { message: 'Month must look like 2026-10' })
  month?: string;
}

export class RecordSalesPayoutDto {
  @IsUUID()
  agentId!: string;

  // Everything this person has earned up to and including this month is marked paid.
  @Matches(MONTH, { message: 'Month must look like 2026-10' })
  throughMonth!: string;

  @IsIn(['MPESA', 'BANK', 'CASH'])
  method!: 'MPESA' | 'BANK' | 'CASH';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class PayoutsQueryDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;
}
