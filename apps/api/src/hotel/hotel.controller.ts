import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, RoomBookingStatus } from '@prisma/client';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { MAX_IMAGE_BYTES } from '../catalog/product-images.service';
import { CancelWithPolicyDto, NoShowDto } from './dto/hotel-ops.dto';
import { HotelChangesService } from './hotel-changes.service';
import { ConfirmBookingPaymentDto, CreateBookingDto, GuestBookingTokenDto, UpsertRoomTypeDto } from './dto/hotel.dto';
import { HotelPublicService } from './hotel-public.service';
import { HotelRoomsService } from './hotel-rooms.service';
import { parseDay } from './room-availability.util';
import { RoomBookingsService } from './room-bookings.service';

const UPLOAD_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
// Generous: guests on a hotel's wifi share one address.
const BOOK_THROTTLE = { default: { limit: 40, ttl: 60_000 } };
const READ_THROTTLE = { default: { limit: 90, ttl: 60_000 } };

/** The hotel's own staff: room types, photos, bookings, check-in and check-out. */
@Controller('hotel')
export class HotelController {
  constructor(
    private readonly rooms: HotelRoomsService,
    private readonly bookings: RoomBookingsService,
    private readonly changes: HotelChangesService,
  ) {}

  /** Whether ZARODA has taken this hotel off the marketplace, and why. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Get('status')
  status() {
    return this.rooms.status();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('room-types')
  listRoomTypes() {
    return this.rooms.listRoomTypes();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('room-types')
  createRoomType(@Body() dto: UpsertRoomTypeDto) {
    return this.rooms.createRoomType(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put('room-types/:id')
  updateRoomType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertRoomTypeDto) {
    return this.rooms.updateRoomType(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete('room-types/:id')
  removeRoomType(@Param('id', ParseUUIDPipe) id: string) {
    return this.rooms.removeRoomType(id);
  }

  /** The photo itself is the request body (Content-Type: image/jpeg|png|webp), same as product and advert photos. */
  @Roles(Role.MANAGER, Role.OWNER)
  @Throttle(UPLOAD_THROTTLE)
  @Post('room-types/:id/photos')
  async addPhoto(@Param('id', ParseUUIDPipe) id: string, @Headers('content-type') contentType: string | undefined, @Req() req: Request) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) throw new PayloadTooLargeException('Photos must be 5MB or smaller');
      chunks.push(chunk);
    }
    return this.rooms.addPhoto(id, (contentType ?? '').split(';')[0].trim().toLowerCase(), Buffer.concat(chunks));
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('room-types/:id/photos/:photoId/cover')
  makeCover(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.rooms.makeCover(id, photoId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete('room-types/:id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    await this.rooms.removePhoto(id, photoId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('bookings')
  listBookings(@Query('status') status?: string, @Query('includePast') includePast?: string) {
    const valid = status && (Object.values(RoomBookingStatus) as string[]).includes(status) ? (status as RoomBookingStatus) : undefined;
    return this.rooms.listBookings({ status: valid, includePast: includePast === 'true' });
  }

  // Check-in and check-out moved to the front desk (front-desk.controller.ts): they need a room and settle the folio.

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post('bookings/:id/no-show')
  noShow(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoShowDto) {
    return this.changes.cancel(id, { reason: dto?.reason ?? 'No-show', waiveFee: dto?.waiveFee }, true);
  }

  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Post('bookings/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelWithPolicyDto) {
    return this.changes.cancel(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('bookings/:id/confirm-payment')
  confirmPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmBookingPaymentDto) {
    return this.bookings.confirmPaymentByHotel(id, dto.receipt);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('availability')
  availability(@Query('from') from?: string, @Query('days') days?: string) {
    return this.rooms.availability(parseDay(from), Number.parseInt(days ?? '14', 10) || 14);
  }
}

/** Public, unauthenticated: guests browsing hotels and booking a room. */
@Controller('public')
export class PublicHotelsController {
  constructor(
    private readonly hotels: HotelPublicService,
    private readonly bookings: RoomBookingsService,
  ) {}

  @Public()
  @Throttle(READ_THROTTLE)
  @Get('hotels')
  list(@Query('area') area?: string, @Query('checkIn') checkIn?: string, @Query('checkOut') checkOut?: string) {
    return this.hotels.listHotels({ area, checkIn, checkOut });
  }

  @Public()
  @Throttle(READ_THROTTLE)
  @Get('hotels/:slug')
  get(@Param('slug') slug: string, @Query('checkIn') checkIn?: string, @Query('checkOut') checkOut?: string) {
    return this.hotels.getHotel(slug, { checkIn, checkOut });
  }

  @Public()
  @Throttle(BOOK_THROTTLE)
  @Post('hotels/:slug/bookings')
  book(@Param('slug') slug: string, @Body() dto: CreateBookingDto) {
    return this.bookings.createBooking(slug, dto);
  }

  @Public()
  @Throttle(READ_THROTTLE)
  @Get('room-bookings/:id')
  getBooking(@Param('id', ParseUUIDPipe) id: string, @Query('k') token: string) {
    return this.bookings.getForGuest(id, token ?? '');
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('room-bookings/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuestBookingTokenDto) {
    return this.bookings.retryForGuest(id, dto.token, dto.phone);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('room-bookings/:id/check')
  @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuestBookingTokenDto) {
    return this.bookings.checkForGuest(id, dto.token);
  }

  /** Tuma's payment webhook for a room deposit. Authenticated by the HMAC in the URL - see RoomBookingsService. */
  @Public()
  @Post('room-bookings/:organizationId/:bookingId/tuma-callback/:token')
  @HttpCode(200)
  tumaCallback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.bookings.handleTumaCallback(organizationId, bookingId, token, body);
  }

  @Public()
  @Post('room-bookings/:organizationId/:bookingId/daraja-callback/:token')
  @HttpCode(200)
  darajaCallback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.bookings.handleDarajaCallback(organizationId, bookingId, token, body);
  }
}
