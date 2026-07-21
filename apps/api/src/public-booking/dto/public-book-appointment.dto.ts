import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class PublicBookAppointmentDto {
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
