import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SalonAppointmentsService } from './salon-appointments.service';
import { SalonAppointmentSalesService } from './salon-appointment-sales.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { CheckoutAppointmentDto } from './dto/checkout-appointment.dto';

// No @Roles() - booking/managing appointments is a routine front-desk
// operation, same tier as core sales or the restaurant module's orders.
@Controller('salon/appointments')
export class SalonAppointmentsController {
  constructor(
    private readonly appointments: SalonAppointmentsService,
    private readonly appointmentSales: SalonAppointmentSalesService,
  ) {}

  @Post()
  create(@Body() dto: CreateAppointmentDto) {
    return this.appointments.create(dto);
  }

  @Get()
  findAll(@Query() query: ListAppointmentsDto) {
    return this.appointments.findAll(query);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.appointments.updateStatus(id, dto);
  }

  @Post(':id/checkout')
  checkout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckoutAppointmentDto,
  ) {
    return this.appointmentSales.checkout(id, dto);
  }
}
