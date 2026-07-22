import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateAppointmentDto {
  /** Client-generated idempotency key (DESIGN.md §6) - resubmitting the same clientId returns the original booking instead of erroring against assertNoOverlap or double-booking the resource. */
  @IsUUID()
  clientId!: string;

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
