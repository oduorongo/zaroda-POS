import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { FarmCropsService } from './farm-crops.service';
import { CreateSeasonDto, CropActivityDto, HarvestDto, UpdateSeasonDto } from './dto/crops.dto';
import { VoidDto } from './dto/livestock.dto';

const { FARM_MANAGER, CROPS_OFFICER } = FarmRoleCode;

/** Zaroda Shamba F4: crop seasons, field work and spraying, harvests (docs/farm). */
@Farm()
@FarmFeature('crops')
@Controller('farm/crops')
export class FarmCropsController {
  constructor(private readonly crops: FarmCropsService) {}

  @Get('seasons')
  seasons(@Req() req: FarmRequest, @Query('status') status?: string) {
    return this.crops.listSeasons(req.farm!, status);
  }

  @Get('seasons/:id')
  season(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.crops.getSeason(req.farm!, id);
  }

  @FarmRoles(FARM_MANAGER, CROPS_OFFICER)
  @Post('seasons')
  createSeason(@Req() req: FarmRequest, @Body() dto: CreateSeasonDto) {
    return this.crops.createSeason(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER, CROPS_OFFICER)
  @Patch('seasons/:id')
  updateSeason(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSeasonDto) {
    return this.crops.updateSeason(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('seasons/:id/close')
  closeSeason(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.crops.closeSeason(req.farm!, id);
  }

  @FarmRoles(FARM_MANAGER, CROPS_OFFICER)
  @Post('seasons/:id/activities')
  addActivity(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CropActivityDto) {
    return this.crops.addActivity(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('activities/:id/void')
  voidActivity(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.crops.voidActivity(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER, CROPS_OFFICER)
  @Post('seasons/:id/harvests')
  addHarvest(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HarvestDto) {
    return this.crops.addHarvest(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('harvests/:id/void')
  voidHarvest(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.crops.voidHarvest(req.farm!, id, dto);
  }
}
