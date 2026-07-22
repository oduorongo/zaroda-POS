import { IsDateString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PublicBookAppointmentDto {
  /** Client-generated idempotency key (DESIGN.md §6) - resubmitting the same clientId (e.g. a customer's browser retrying after a dropped response) returns the original booking instead of double-booking. */
  @IsUUID()
  clientId!: string;

  @IsString()
  resourceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  serviceName!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName!: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  customerPhone!: string;
}
