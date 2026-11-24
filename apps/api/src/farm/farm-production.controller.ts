import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { FarmProductionService } from './farm-production.service';
import { addDays, todayKey } from './farm-livestock.util';
import { YieldBy } from './farm-production.util';
import { EggRecordDto, MilkSessionDto, ProduceRecordDto, ProduceSettingsDto } from './dto/production.dto';
import { VoidDto } from './dto/livestock.dto';

const { FARM_MANAGER, HERDSMAN, STOREKEEPER, SALES } = FarmRoleCode;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD from the query, else the fallback. */
function day(v: string | undefined, fallback: string): string {
  if (v === undefined || v === '') return fallback;
  if (!DAY.test(v)) throw new BadRequestException('Dates are YYYY-MM-DD');
  return v;
}

/** Zaroda Shamba F3: milk, eggs and other produce, and the yields they add up to (docs/farm). */
@Farm()
@FarmFeature('production')
@Controller('farm/production')
export class FarmProductionController {
  constructor(private readonly production: FarmProductionService) {}

  @Get('settings')
  settings() {
    return this.production.getSettings();
  }

  @FarmRoles(FARM_MANAGER)
  @Put('settings')
  updateSettings(@Body() dto: ProduceSettingsDto) {
    return this.production.updateSettings(dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('settings/create-products')
  createProducts() {
    return this.production.createProducts({});
  }

  @Get('milk')
  milkSheet(@Req() req: FarmRequest, @Query('date') date?: string) {
    return this.production.milkSheet(req.farm!, day(date, todayKey()));
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN)
  @Post('milk')
  recordMilk(@Req() req: FarmRequest, @Body() dto: MilkSessionDto) {
    return this.production.recordMilk(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('milk/:id/void')
  voidMilk(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.production.voidMilk(req.farm!, id, dto);
  }

  @Get('eggs')
  eggs(@Req() req: FarmRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const end = day(to, todayKey());
    return this.production.listEggs(req.farm!, day(from, addDays(end, -13)), end);
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN)
  @Post('eggs')
  recordEggs(@Req() req: FarmRequest, @Body() dto: EggRecordDto) {
    return this.production.recordEggs(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('eggs/:id/void')
  voidEggs(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.production.voidEggs(req.farm!, id, dto);
  }

  @Get('produce')
  produce(@Query('from') from?: string, @Query('to') to?: string) {
    const end = day(to, todayKey());
    return this.production.listProduce(day(from, addDays(end, -89)), end);
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN, STOREKEEPER, SALES)
  @Post('produce')
  recordProduce(@Body() dto: ProduceRecordDto) {
    return this.production.recordProduce(dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('produce/:id/void')
  voidProduce(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.production.voidProduce(id, dto);
  }

  @Get('yields')
  yields(@Req() req: FarmRequest, @Query('by') by?: string) {
    const b: YieldBy = by === 'week' || by === 'month' ? by : 'day';
    return this.production.yields(req.farm!, b);
  }
}
