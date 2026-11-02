import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class PayInstalmentDto {
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  phone!: string;

  /** Pay the whole school year at the discount (January only), started from this instalment. */
  @IsBoolean()
  @IsOptional()
  fullYear?: boolean;
}

export class SeasonalTermDto {
  @IsInt()
  @Min(1)
  @Max(6)
  term!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label!: string;

  /** 0.5 = 50% of the annual price. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  shareRate!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  dueMonth!: number;

  @IsInt()
  @Min(1)
  @Max(28, { message: 'Choose a due day up to the 28th (every month has it)' })
  dueDay!: number;

  @IsInt()
  @Min(0)
  @Max(120)
  graceDays!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  fromMonth!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  toMonth!: number;
}

export class SeasonalSettingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => SeasonalTermDto)
  @IsOptional()
  terms?: SeasonalTermDto[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  minFirstPaymentKes?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  setupFeeKes?: number;

  /** 0.1 = 10% off for paying the whole year. */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(0.5)
  @IsOptional()
  payInFullDiscountRate?: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  payInFullUntilMonth?: number;
}

export class ShiftDueDateDto {
  @IsInt()
  @Min(2024)
  @Max(2100)
  schoolYear!: number;

  @IsInt()
  @Min(1)
  @Max(6)
  term!: number;

  @IsDateString({ strict: true })
  dueDate!: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  reason?: string;
}

export class MarkInstalmentPaidDto {
  @IsIn(['MPESA', 'BANK', 'CASH'])
  method!: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  reference?: string;

  @IsBoolean()
  @IsOptional()
  fullYear?: boolean;
}
