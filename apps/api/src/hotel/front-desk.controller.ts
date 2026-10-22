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
import { HotelRoomStatus, Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  BulkRoomsDto,
  CreateRoomDto,
  SetRoomStatusDto,
  UpdateRoomDto,
} from './dto/front-desk.dto';
import { PhysicalRoomsService } from './physical-rooms.service';

// Who may do what at the front desk. The reception team (cashier up) takes bookings, checks guests in and out and takes
// payments; a supervisor can also move rooms and mark one out of order; rates, rate overrides, adjustments, refunds, room
// types and the room list are for managers and owners. Reads are open to every back-office role, auditors included.
const RECEPTION = [Role.CASHIER, Role.SUPERVISOR, Role.MANAGER, Role.OWNER];
const READERS = [...RECEPTION, Role.AUDITOR];
const MANAGERS = [Role.MANAGER, Role.OWNER];

@Controller('hotel')
export class FrontDeskController {
  constructor(private readonly rooms: PhysicalRoomsService) {}

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
}
