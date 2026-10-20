import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { EXPENSE_CATEGORY_KEYS, PAID_WITH } from '../expense-categories';

export class CreateExpenseDto {
  /** The day the money was spent, "2026-10-21". */
  @IsDateString({ strict: true }, { message: 'Choose the date the money was spent' })
  spentOn!: string;

  @IsIn(EXPENSE_CATEGORY_KEYS, { message: 'Choose what the money was spent on' })
  category!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the amount in shillings, e.g. 1500 or 1500.50' })
  @Min(1, { message: 'The amount must be at least KES 1' })
  @Max(100_000_000)
  amount!: number;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;

  @IsIn([...PAID_WITH])
  @IsOptional()
  paidWith?: string;

  /** Leave out for "the whole business". */
  @IsUUID()
  @IsOptional()
  branchId?: string;
}

export class UpdateExpenseDto {
  @IsDateString({ strict: true })
  @IsOptional()
  spentOn?: string;

  @IsIn(EXPENSE_CATEGORY_KEYS)
  @IsOptional()
  category?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000_000)
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;

  @IsIn([...PAID_WITH])
  @IsOptional()
  paidWith?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;
}

export class ListExpensesQueryDto {
  /** First day, "2026-10-01" (inclusive). */
  @IsDateString({ strict: true })
  @IsOptional()
  from?: string;

  /** Last day, "2026-10-31" (inclusive). */
  @IsDateString({ strict: true })
  @IsOptional()
  to?: string;

  @IsIn(EXPENSE_CATEGORY_KEYS)
  @IsOptional()
  category?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;
}
