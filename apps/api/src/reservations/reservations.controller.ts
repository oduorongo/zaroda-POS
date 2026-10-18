import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, TableReservationStatus } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConfirmReservationDto, CreateReservationDto, DeclineReservationDto, GuestReservationTokenDto, ReservationSettingsDto } from './dto/reservation.dto';
import { ReservationsService } from './reservations.service';

// Generous: guests on a restaurant's wifi share one address. Each request still needs a reachable phone number, and a
// phone can only hold a few open requests.
const CREATE_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const READ_THROTTLE = { default: { limit: 90, ttl: 60_000 } };

/** The restaurant's own staff: answer requests, seat guests, and switch reservations on or off. Supervisors and above. */
@Controller('restaurant/reservations')
export class RestaurantReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Get()
  list(@Query('date') date?: string, @Query('status') status?: string, @Query('includePast') includePast?: string) {
    const valid = status && (Object.values(TableReservationStatus) as string[]).includes(status) ? (status as TableReservationStatus) : undefined;
    return this.reservations.list({ date, status: valid, includePast: includePast === 'true' });
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('settings')
  settings() {
    return this.reservations.getSettings();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put('settings')
  setSettings(@Body() dto: ReservationSettingsDto) {
    return this.reservations.setSettings(dto.enabled);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post(':id/confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReservationDto) {
    return this.reservations.confirm(id, dto);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post(':id/decline')
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineReservationDto) {
    return this.reservations.decline(id, dto);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post(':id/seat')
  seat(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.seat(id);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post(':id/no-show')
  noShow(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.noShow(id);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineReservationDto) {
    return this.reservations.cancel(id, dto.reason);
  }
}

/** Public, unauthenticated: a guest asking a restaurant for a table. */
@Controller('public')
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Public()
  @Throttle(READ_THROTTLE)
  @Get('shops/:slug/reservations/info')
  info(@Param('slug') slug: string) {
    return this.reservations.info(slug);
  }

  @Public()
  @Throttle(CREATE_THROTTLE)
  @Post('shops/:slug/reservations')
  create(@Param('slug') slug: string, @Body() dto: CreateReservationDto) {
    return this.reservations.create(slug, dto);
  }

  @Public()
  @Throttle(READ_THROTTLE)
  @Get('reservations/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Query('k') token: string) {
    return this.reservations.getForGuest(id, token ?? '');
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('reservations/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuestReservationTokenDto) {
    return this.reservations.cancelForGuest(id, dto.token);
  }
}
