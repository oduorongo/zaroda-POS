import { IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

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
