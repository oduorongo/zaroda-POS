import { IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, IsInt, Min } from 'class-validator';

const METHODS = ['MPESA', 'BANK', 'CASH'] as const;

export class RecordPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn(METHODS)
  method!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  reference?: string;
}

export class SetSuspensionDto {
  @IsBoolean()
  suspended!: boolean;
}

export class SetAgreedPriceDto {
  /** Whole shillings a month, inside the plan's range. */
  @IsNumber()
  @IsPositive()
  monthlyPriceKes!: number;
}

export class SetExtraTillsDto {
  @IsInt()
  @Min(0)
  extraTills!: number;
}

export class ChangePlanDto {
  @IsString()
  @MaxLength(40)
  planTier!: string;
}
