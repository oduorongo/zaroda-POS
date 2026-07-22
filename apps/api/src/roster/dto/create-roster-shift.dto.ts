import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRosterShiftDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  orgUserId!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
