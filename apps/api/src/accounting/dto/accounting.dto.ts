import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;

export class CreateAccountDto {
  /** "6110": numbers, optionally with a dash part. */
  @Matches(/^\d{3,6}(-\d{1,3})?$/, { message: 'The account code is 3 to 6 digits, e.g. 6110' })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn([...ACCOUNT_TYPES], { message: 'Choose the kind of account' })
  type!: (typeof ACCOUNT_TYPES)[number];

  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;
}

export class UpdateAccountDto {
  @Matches(/^\d{3,6}(-\d{1,3})?$/, { message: 'The account code is 3 to 6 digits, e.g. 6110' })
  @IsOptional()
  code?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @IsOptional()
  name?: string;

  @IsIn([...ACCOUNT_TYPES])
  @IsOptional()
  type?: (typeof ACCOUNT_TYPES)[number];

  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class JournalLineDto {
  @IsUUID()
  accountId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000_000)
  debit!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000_000)
  credit!: number;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  memo?: string;
}

export class CreateJournalDto {
  @IsDateString({ strict: true }, { message: 'Choose the date of the journal' })
  date!: string;

  @IsString()
  @MinLength(3, { message: 'Say what the journal is for' })
  @MaxLength(300)
  memo!: string;

  /** OPENING for the balances the books start with; MANUAL for anything else. */
  @IsIn(['MANUAL', 'OPENING'])
  @IsOptional()
  kind?: 'MANUAL' | 'OPENING';

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  @ArrayMinSize(2, { message: 'A journal needs at least two lines' })
  @ArrayMaxSize(200)
  lines!: JournalLineDto[];
}

export class ReverseJournalDto {
  /** The day to undo it on; leave out for today. */
  @IsDateString({ strict: true })
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  reason?: string;
}

export class LedgerSettingsDto {
  /** Post automatically from this day on. Can only be moved earlier once anything has been posted. */
  @IsDateString({ strict: true })
  @IsOptional()
  startDate?: string;

  /** Close the books up to and including this day; null opens them again (owner only). */
  @IsDateString({ strict: true })
  @IsOptional()
  lockDate?: string | null;

  @IsIn(['CASH', 'MPESA', 'BANK'])
  @IsOptional()
  payrollPaidFrom?: string;
}

export class RangeQueryDto {
  @IsDateString({ strict: true })
  @IsOptional()
  from?: string;

  @IsDateString({ strict: true })
  @IsOptional()
  to?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;
}

export class AsOfQueryDto {
  @IsDateString({ strict: true })
  @IsOptional()
  asOf?: string;
}

export class JournalListQueryDto extends RangeQueryDto {
  @IsIn(['AUTO', 'MANUAL', 'OPENING', 'REVERSAL'])
  @IsOptional()
  kind?: 'AUTO' | 'MANUAL' | 'OPENING' | 'REVERSAL';

  @IsString()
  @IsOptional()
  @MaxLength(40)
  sourceType?: string;

  @IsUUID()
  @IsOptional()
  sourceId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;
}
