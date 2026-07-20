import { IsEnum } from 'class-validator';
import { SalonAppointmentStatus } from '@prisma/client';

export class UpdateAppointmentStatusDto {
  @IsEnum(SalonAppointmentStatus)
  status!: SalonAppointmentStatus;
}
