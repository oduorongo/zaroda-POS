import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PublicBookingService } from './public-booking.service';
import { PublicBookAppointmentDto } from './dto/public-book-appointment.dto';

// Every route @Public() (skips the global JwtAuthGuard - see
// app.module.ts) since this whole controller is deliberately reachable
// with no authentication at all, unlike everything else in this API.
// organizationId/branchId come from the URL, not a token - see
// PublicBookingService's own comment on the trust-model implications of
// that. Booking creation is throttled tighter than the general 100/min
// default (app.module.ts) - the same "an unauthenticated write is worth
// rate-limiting" reasoning as auth.controller.ts's login/register.
const BOOK_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('public/salon/:organizationId/:branchId')
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  @Public()
  @Get('resources')
  listResources(
    @Param('organizationId') organizationId: string,
    @Param('branchId') branchId: string,
  ) {
    return this.booking.listResources(organizationId, branchId);
  }

  @Public()
  @Get('availability')
  getAvailability(
    @Param('organizationId') organizationId: string,
    @Param('branchId') branchId: string,
    @Query('resourceId') resourceId: string,
    @Query('date') date: string,
  ) {
    return this.booking.getAvailability(
      organizationId,
      branchId,
      resourceId,
      date,
    );
  }

  @Public()
  @Throttle(BOOK_THROTTLE)
  @Post('appointments')
  bookAppointment(
    @Param('organizationId') organizationId: string,
    @Param('branchId') branchId: string,
    @Body() dto: PublicBookAppointmentDto,
  ) {
    return this.booking.bookAppointment(organizationId, branchId, dto);
  }
}
