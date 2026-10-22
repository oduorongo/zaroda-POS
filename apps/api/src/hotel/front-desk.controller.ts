import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { HotelRoomStatus, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  AdjustmentDto,
  BookingsQueryDto,
  BulkRoomsDto,
  CreateFrontDeskBookingDto,
  CheckInDto,
  CheckOutDto,
  CreateRoomDto,
  MoveRoomDto,
  PostPaymentDto,
  RefundDto,
  SetRoomStatusDto,
  UpdateRoomDto,
} from './dto/front-desk.dto';
import { FrontDeskStayService } from './front-desk-stay.service';
import { FrontDeskService } from './front-desk.service';
import { HotelFolioService } from './hotel-folio.service';
import { PhysicalRoomsService } from './physical-rooms.service';

// Who may do what at the front desk. The reception team (cashier up) takes bookings, checks guests in and out and takes
// payments; a supervisor can also move rooms and mark one out of order; rates, rate overrides, adjustments, refunds, room
// types and the room list are for managers and owners. Reads are open to every back-office role, auditors included.
// (A rate override is checked in the service, because it is a field of the booking, not a separate route.)
export const RECEPTION = [
  Role.CASHIER,
  Role.SUPERVISOR,
  Role.MANAGER,
  Role.OWNER,
];
export const READERS = [...RECEPTION, Role.AUDITOR];
export const SUPERVISORS = [Role.SUPERVISOR, Role.MANAGER, Role.OWNER];
export const MANAGERS = [Role.MANAGER, Role.OWNER];

@Controller('hotel')
export class FrontDeskController {
  constructor(
    private readonly rooms: PhysicalRoomsService,
    private readonly desk: FrontDeskService,
    private readonly folios: HotelFolioService,
    private readonly stay: FrontDeskStayService,
  ) {}

  // ── Rooms and housekeeping ──
  @Roles(...READERS)
  @Get('rooms')
  listRooms(
    @Query('roomTypeId') roomTypeId?: string,
    @Query('status') status?: HotelRoomStatus,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.rooms.list({
      roomTypeId,
      status,
      includeInactive: includeInactive === 'true',
    });
  }

  @Roles(...MANAGERS)
  @Post('rooms')
  createRoom(@Body() dto: CreateRoomDto) {
    return this.rooms.create(dto);
  }

  @Roles(...MANAGERS)
  @Post('rooms/bulk')
  createRooms(@Body() dto: BulkRoomsDto) {
    return this.rooms.createMany(dto);
  }

  @Roles(...MANAGERS)
  @Patch('rooms/:id')
  updateRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.rooms.update(id, dto);
  }

  @Roles(...RECEPTION)
  @Patch('rooms/:id/status')
  setRoomStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoomStatusDto,
  ) {
    return this.rooms.setStatus(id, dto);
  }

  // ── The day's board and bookings ──
  @Roles(...READERS)
  @Get('desk')
  board(@Query() query: BookingsQueryDto) {
    return this.desk.board(query.date);
  }

  @Roles(...RECEPTION)
  @Post('bookings')
  createBooking(@Body() dto: CreateFrontDeskBookingDto) {
    return this.desk.create(dto);
  }

  @Roles(...READERS)
  @Get('bookings/:id')
  booking(@Param('id', ParseUUIDPipe) id: string) {
    return this.desk.detail(id);
  }

  /** Checked-in guests by room, for "charge to room" at the till. */
  @Roles(...RECEPTION)
  @Get('in-house')
  inHouse() {
    return this.desk.inHouse();
  }

  // ── The stay ──
  @Roles(...RECEPTION)
  @Post('bookings/:id/check-in')
  @HttpCode(200)
  checkIn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckInDto) {
    return this.stay.checkIn(id, dto);
  }

  @Roles(...SUPERVISORS)
  @Post('bookings/:id/move-room')
  @HttpCode(200)
  moveRoom(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveRoomDto) {
    return this.stay.moveRoom(id, dto);
  }

  // Leaving a balance owing is for managers; the service checks that against the reason that comes with it.
  @Roles(...RECEPTION)
  @Post('bookings/:id/check-out')
  @HttpCode(200)
  checkOut(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckOutDto) {
    return this.stay.checkOut(id, dto);
  }

  // ── The folio ──
  @Roles(...READERS)
  @Get('bookings/:id/folio')
  folio(@Param('id', ParseUUIDPipe) id: string) {
    return this.folios.view(id);
  }

  @Roles(...RECEPTION)
  @Post('bookings/:id/payments')
  postPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostPaymentDto,
  ) {
    return this.folios.postPayment(id, dto);
  }

  @Roles(...MANAGERS)
  @Post('bookings/:id/adjustments')
  @HttpCode(201)
  postAdjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustmentDto,
  ) {
    return this.folios.postAdjustment(id, dto);
  }

  @Roles(...MANAGERS)
  @Post('bookings/:id/refunds')
  postRefund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    return this.folios.postRefund(id, dto);
  }
}
