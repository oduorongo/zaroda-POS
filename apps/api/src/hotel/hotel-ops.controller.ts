import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  AmendBookingDto,
  CancellationRefundDto,
  GuestLookupDto,
  HotelSettingsDto,
  MealPricesDto,
  NightAuditDto,
  QuoteDto,
  RateCardDto,
  ReportQueryDto,
  SeasonDto,
  TaxesDto,
  UpdateGuestDto,
} from './dto/hotel-ops.dto';
import {
  MANAGERS,
  READERS,
  RECEPTION,
  SUPERVISORS,
} from './front-desk.controller';
import { HotelChangesService } from './hotel-changes.service';
import { HotelGuestsService } from './hotel-guests.service';
import {
  HotelReportsService,
  REPORT_NAMES,
  ReportName,
} from './hotel-reports.service';
import { HotelSettingsService } from './hotel-settings.service';
import { NightAuditService } from './night-audit.service';

// Who may do what: the desk (cashier up) looks guests up and reads prices; a supervisor or above changes a stay and
// closes the day; rates, taxes and the hotel's rules, refunds and the reports are for managers and owners (auditors read).
const REPORTERS = [Role.MANAGER, Role.OWNER, Role.AUDITOR];

@Controller('hotel')
export class HotelOpsController {
  constructor(
    private readonly settings: HotelSettingsService,
    private readonly changes: HotelChangesService,
    private readonly guests: HotelGuestsService,
    private readonly audits: NightAuditService,
    private readonly reports: HotelReportsService,
  ) {}

  // ── The hotel's rules and taxes ──
  @Roles(...READERS)
  @Get('settings')
  getSettings() {
    return this.settings.settings();
  }

  @Roles(...MANAGERS)
  @Put('settings')
  putSettings(@Body() dto: HotelSettingsDto) {
    return this.settings.updateSettings(dto);
  }

  @Roles(...READERS)
  @Get('taxes')
  getTaxes() {
    return this.settings.taxes();
  }

  @Roles(...MANAGERS)
  @Put('taxes')
  putTaxes(@Body() dto: TaxesDto) {
    return this.settings.setTaxes(dto);
  }

  @Roles(...RECEPTION)
  @Post('bookings/quote')
  @HttpCode(200)
  quote(@Body() dto: QuoteDto) {
    return this.settings.quote(dto);
  }

  // ── Rate plans ──
  @Roles(...READERS)
  @Get('room-types/:id/rates')
  rates(@Param('id', ParseUUIDPipe) id: string) {
    return this.settings.rates(id);
  }

  @Roles(...MANAGERS)
  @Put('room-types/:id/rate-card')
  rateCard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RateCardDto) {
    return this.settings.setRateCard(id, dto);
  }

  @Roles(...MANAGERS)
  @Post('room-types/:id/seasons')
  addSeason(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SeasonDto) {
    return this.settings.addSeason(id, dto);
  }

  @Roles(...MANAGERS)
  @Delete('room-types/:id/seasons/:seasonId')
  removeSeason(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('seasonId', ParseUUIDPipe) seasonId: string,
  ) {
    return this.settings.removeSeason(id, seasonId);
  }

  @Roles(...MANAGERS)
  @Put('room-types/:id/meal-prices')
  mealPrices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MealPricesDto,
  ) {
    return this.settings.setMealPrices(id, dto);
  }

  // ── Changing and cancelling a booking ──
  @Roles(...SUPERVISORS)
  @Post('bookings/:id/amend')
  @HttpCode(200)
  amend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AmendBookingDto) {
    return this.changes.amend(id, dto);
  }

  @Roles(...SUPERVISORS)
  @Get('bookings/:id/cancellation-preview')
  cancelPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('waive') waive?: string,
  ) {
    return this.changes.cancelPreview(id, waive === 'true');
  }

  @Roles(...MANAGERS)
  @Post('bookings/:id/cancellation-refund')
  cancellationRefund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancellationRefundDto,
  ) {
    return this.changes.recordRefund(id, dto);
  }

  // ── The guest register ──
  @Roles(...RECEPTION)
  @Get('guests/lookup')
  lookup(@Query() q: GuestLookupDto) {
    return this.guests.lookup(q);
  }

  @Roles(...SUPERVISORS)
  @Get('guests')
  listGuests(@Query('search') search?: string) {
    return this.guests.list(search);
  }

  @Roles(...SUPERVISORS)
  @Get('guests/:id')
  guest(@Param('id', ParseUUIDPipe) id: string) {
    return this.guests.detail(id);
  }

  @Roles(...SUPERVISORS)
  @Patch('guests/:id')
  updateGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuestDto,
  ) {
    return this.guests.update(id, dto);
  }

  @Roles(...READERS)
  @Get('bookings/:id/registration-card')
  card(@Param('id', ParseUUIDPipe) id: string) {
    return this.guests.registrationCard(id);
  }

  // ── Night audit ──
  @Roles(...SUPERVISORS)
  @Post('night-audit')
  @HttpCode(200)
  closeDay(@Body() dto: NightAuditDto) {
    return this.audits.run(dto.date);
  }

  @Roles(...REPORTERS)
  @Get('night-audits')
  audit(@Query('limit') limit?: string) {
    return this.audits.list(Number.parseInt(limit ?? '31', 10) || 31);
  }

  // ── Reports ──
  @Roles(...REPORTERS)
  @Get('reports/:name')
  @Header('Cache-Control', 'no-store')
  async report(
    @Param('name') name: string,
    @Query() q: Partial<ReportQueryDto> & { format?: string },
  ) {
    if (!(REPORT_NAMES as readonly string[]).includes(name))
      throw new BadRequestException('Unknown report');
    const report = await this.reports.build(
      name as ReportName,
      q.from,
      q.to,
      q.date,
    );
    if (q.format === 'csv')
      return {
        filename: `${name}-${report.from}${report.to !== report.from ? `-to-${report.to}` : ''}.csv`,
        csv: this.reports.csv(report),
      };
    return report;
  }
}
