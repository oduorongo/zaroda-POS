import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../../auth/public.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RentalReadOnlyInterceptor } from '../rental-read-only.interceptor';
import {
  CleaningDoneDto,
  CleaningDto,
  OwnerDto,
  StatementQueryDto,
  StayBlockDto,
  StayCalendarQueryDto,
  StayCancelDto,
  StayChangeDto,
  StayDto,
  StayFeedDto,
  StayListQueryDto,
  StayPaymentDto,
  StayTextsDto,
  StayUnitDto,
  StayVoidDto,
} from './stays.dto';
import { RentalStaysService } from './stays.service';

const DESK = [Role.MANAGER, Role.OWNER, Role.CARETAKER];

/** Short stays. Owners and managers run it all; a caretaker works the calendar, guests, payments and cleaning for their properties. */
@Controller('rental/stays')
@Roles(Role.MANAGER, Role.OWNER)
@UseInterceptors(RentalReadOnlyInterceptor)
export class RentalStaysController {
  constructor(private readonly stays: RentalStaysService) {}

  @Roles(...DESK)
  @Get('units')
  units() {
    return this.stays.listUnits();
  }

  @Put('units/:unitId')
  saveUnit(@Param('unitId', ParseUUIDPipe) unitId: string, @Body() dto: StayUnitDto) {
    return this.stays.saveUnit(unitId, dto);
  }

  @Post('units/:unitId/new-calendar-link')
  newLink(@Param('unitId', ParseUUIDPipe) unitId: string) {
    return this.stays.newCalendarLink(unitId);
  }

  @Post('units/:unitId/feeds')
  addFeed(@Param('unitId', ParseUUIDPipe) unitId: string, @Body() dto: StayFeedDto) {
    return this.stays.addFeed(unitId, dto);
  }

  @Post('feeds/:id/sync')
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.syncNow(id);
  }

  @Delete('feeds/:id')
  removeFeed(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.removeFeed(id);
  }

  @Get('owners')
  owners() {
    return this.stays.listOwners();
  }

  @Post('owners')
  addOwner(@Body() dto: OwnerDto) {
    return this.stays.saveOwner(null, dto);
  }

  @Put('owners/:id')
  saveOwner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OwnerDto) {
    return this.stays.saveOwner(id, dto);
  }

  @Delete('owners/:id')
  removeOwner(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.removeOwner(id);
  }

  @Get('statements')
  @Header('Cache-Control', 'no-store')
  async statement(@Query() q: StatementQueryDto) {
    if (q.ownerId && q.ownerId !== 'own' && !/^[0-9a-f-]{36}$/i.test(q.ownerId)) throw new BadRequestException('Unknown owner');
    const s = await this.stays.statement(q);
    return q.format === 'csv' ? { filename: `owner-statement-${q.month}.csv`, csv: this.stays.statementCsv(s) } : s;
  }

  @Get('settings')
  settings() {
    return this.stays.getSettings();
  }

  @Put('settings')
  setSettings(@Body() dto: StayTextsDto) {
    return this.stays.setSettings(dto.stayTexts);
  }

  @Roles(...DESK)
  @Get('calendar')
  calendar(@Query() q: StayCalendarQueryDto) {
    return this.stays.calendar(q);
  }

  @Roles(...DESK)
  @Get('quote')
  quote(@Query('unitId', ParseUUIDPipe) unitId: string, @Query('checkIn') checkIn: string, @Query('checkOut') checkOut: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut ?? '')) throw new BadRequestException('Pick the check-in and check-out dates');
    return this.stays.quote(unitId, checkIn, checkOut);
  }

  @Roles(...DESK)
  @Post('blocks')
  addBlock(@Body() dto: StayBlockDto) {
    return this.stays.addBlock(dto);
  }

  @Roles(...DESK)
  @Delete('blocks/:id')
  removeBlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.removeBlock(id);
  }

  @Roles(...DESK)
  @Get('cleanings')
  cleanings(@Query('view') view?: string) {
    return this.stays.listCleanings(view);
  }

  @Roles(...DESK)
  @Post('cleanings')
  addCleaning(@Body() dto: CleaningDto) {
    return this.stays.addCleaning(dto);
  }

  @Roles(...DESK)
  @Post('cleanings/:id/done')
  @HttpCode(200)
  cleaningDone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CleaningDoneDto) {
    return this.stays.cleaningDone(id, dto);
  }

  @Roles(...DESK)
  @Get()
  list(@Query() q: StayListQueryDto) {
    return this.stays.listStays(q);
  }

  @Roles(...DESK)
  @Post()
  create(@Body() dto: StayDto) {
    return this.stays.createStay(dto);
  }

  @Roles(...DESK)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.getStay(id);
  }

  @Roles(...DESK)
  @Patch(':id')
  change(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StayChangeDto) {
    return this.stays.changeStay(id, dto);
  }

  @Roles(...DESK)
  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.checkIn(id);
  }

  @Roles(...DESK)
  @Post(':id/check-out')
  @HttpCode(200)
  checkOut(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.checkOut(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StayCancelDto) {
    return this.stays.cancel(id, dto);
  }

  @Roles(...DESK)
  @Post(':id/no-show')
  @HttpCode(200)
  noShow(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StayCancelDto) {
    return this.stays.cancel(id, dto, true);
  }

  @Roles(...DESK)
  @Post(':id/payments')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StayPaymentDto) {
    return this.stays.addPayment(id, dto);
  }

  @Post(':id/payments/:paymentId/void')
  @HttpCode(200)
  voidPayment(@Param('id', ParseUUIDPipe) id: string, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: StayVoidDto) {
    return this.stays.voidPayment(id, paymentId, dto.reason);
  }
}

/** The calendar Airbnb and Booking.com read (busy dates only, no guest details). The secret in the address is the key. */
@Controller('public/rental-stays')
export class RentalStaysCalendarController {
  constructor(private readonly stays: RentalStaysService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':organizationId/:unitId/:file')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  calendar(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Param('file') file: string,
    @Query('for') forSource?: string,
  ) {
    const token = file.replace(/\.ics$/, '');
    if (forSource && !['AIRBNB', 'BOOKING_COM', 'OTHER'].includes(forSource)) throw new BadRequestException('Unknown calendar');
    return this.stays.exportCalendar(organizationId, unitId, token, forSource);
  }
}
