import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  resourceId!: string;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsString()
  @MaxLength(100)
  serviceName!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}
