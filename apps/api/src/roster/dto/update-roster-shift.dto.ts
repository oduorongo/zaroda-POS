import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRosterShiftDto {
  @IsDateString()
  @IsOptional()
  startTime?: string;

  @IsDateString()
  @IsOptional()
  endTime?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
