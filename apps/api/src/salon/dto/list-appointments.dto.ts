import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SalonAppointmentStatus } from '@prisma/client';

export class ListAppointmentsDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  resourceId?: string;

  @IsEnum(SalonAppointmentStatus)
  @IsOptional()
  status?: SalonAppointmentStatus;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;
}
