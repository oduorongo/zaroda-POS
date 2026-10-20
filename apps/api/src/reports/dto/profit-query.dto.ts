import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class ProfitQueryDto {
  /** First day, "2026-10-01" (inclusive, Nairobi time). */
  @IsDateString({ strict: true }, { message: 'Choose a start date' })
  from!: string;

  /** Last day, "2026-10-31" (inclusive). */
  @IsDateString({ strict: true }, { message: 'Choose an end date' })
  to!: string;

  /** Rows by day, week or month. Left out, it follows the length of the period. */
  @IsIn(['day', 'week', 'month'])
  @IsOptional()
  groupBy?: 'day' | 'week' | 'month';

  @IsUUID()
  @IsOptional()
  branchId?: string;
}
