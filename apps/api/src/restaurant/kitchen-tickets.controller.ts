import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { KitchenTicketStatus } from '@prisma/client';
import { KitchenTicketsService } from './kitchen-tickets.service';

// No @Roles restriction - the KDS screen and firing a course are both
// routine floor/kitchen operations, same tier as everything else a
// cashier/server does at the register.
@Controller('restaurant')
export class KitchenTicketsController {
  constructor(private readonly tickets: KitchenTicketsService) {}

  @Get('kitchen-tickets')
  findAll(
    @Query('stationId') stationId?: string,
    @Query('status') status?: KitchenTicketStatus,
  ) {
    return this.tickets.findAll({ stationId, status });
  }

  @Patch('kitchen-tickets/:id/advance')
  advance(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.advanceStatus(id);
  }

  @Post('sales/:saleId/courses/:courseNumber/fire')
  fireCourse(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Param('courseNumber', ParseIntPipe) courseNumber: number,
  ) {
    return this.tickets.fireCourse(saleId, courseNumber);
  }
}
