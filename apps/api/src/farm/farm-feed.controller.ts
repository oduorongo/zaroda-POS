import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { FarmFeedService } from './farm-feed.service';
import { addDays, todayKey } from './farm-livestock.util';
import { FeedBatchDto, FeedingDto, RationDto } from './dto/feed.dto';
import { VoidDto } from './dto/livestock.dto';

const { FARM_MANAGER, FEED_MILLER, HERDSMAN, STOREKEEPER } = FarmRoleCode;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | undefined, fallback: string) => {
  if (!v) return fallback;
  if (!DAY.test(v)) throw new BadRequestException('Dates are YYYY-MM-DD');
  return v;
};

/**
 * Zaroda Shamba F5: feeding and feed figures on every plan; rations and mixing batches on Mkulima and up (@FarmFeature('feed')).
 * A route's own feature replaces the class's.
 */
@Farm()
@FarmFeature('livestock')
@Controller('farm/feed')
export class FarmFeedController {
  constructor(private readonly feed: FarmFeedService) {}

  @FarmFeature('feed')
  @Get('rations')
  rations() {
    return this.feed.listRations();
  }

  @FarmFeature('feed')
  @FarmRoles(FARM_MANAGER)
  @Post('rations')
  createRation(@Body() dto: RationDto) {
    return this.feed.saveRation(dto);
  }

  @FarmFeature('feed')
  @FarmRoles(FARM_MANAGER)
  @Put('rations/:id')
  updateRation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RationDto) {
    return this.feed.saveRation(dto, id);
  }

  @FarmFeature('feed')
  @Get('batches')
  batches() {
    return this.feed.listBatches();
  }

  @FarmFeature('feed')
  @FarmRoles(FARM_MANAGER, FEED_MILLER)
  @Post('batches')
  recordBatch(@Body() dto: FeedBatchDto) {
    return this.feed.recordBatch(dto);
  }

  @FarmFeature('feed')
  @FarmRoles(FARM_MANAGER)
  @Post('batches/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.feed.approveBatch(id);
  }

  @FarmFeature('feed')
  @FarmRoles(FARM_MANAGER)
  @Post('batches/:id/reverse')
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.feed.reverseBatch(id, dto);
  }

  @Get('feedings')
  feedings(@Req() req: FarmRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const end = day(to, todayKey());
    return this.feed.listFeedings(req.farm!, day(from, addDays(end, -6)), end);
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN, FEED_MILLER, STOREKEEPER)
  @Post('feedings')
  recordFeeding(@Req() req: FarmRequest, @Body() dto: FeedingDto) {
    return this.feed.recordFeeding(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('feedings/:id/void')
  voidFeeding(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.feed.voidFeeding(req.farm!, id, dto);
  }

  @Get('report')
  report(@Req() req: FarmRequest, @Query('days') days?: string) {
    const d = Number(days);
    return this.feed.report(req.farm!, Number.isInteger(d) && d >= 7 && d <= 365 ? d : 30);
  }
}
