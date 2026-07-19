import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ReportFiltersDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  /** ISO date/datetime - inclusive lower bound on Sale.createdAt. */
  @IsDateString()
  @IsOptional()
  from?: string;

  /** ISO date/datetime - exclusive upper bound on Sale.createdAt. */
  @IsDateString()
  @IsOptional()
  to?: string;
}
