import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { FarmService } from './farm.service';
import { FarmSetupService } from './farm-setup.service';
import { CreateFarmEnterpriseDto, CreateFarmUnitDto, SetFarmRolesDto, UpdateFarmEnterpriseDto, UpdateFarmSettingsDto, UpdateFarmUnitDto } from './dto/farm.dto';

const MANAGE = [FarmRoleCode.FARM_MANAGER];

/** Zaroda Shamba F1: the farm overview, settings, layout, enterprises and staff roles (docs/farm). */
@Farm()
@FarmFeature('layout')
@Controller('farm')
export class FarmController {
  constructor(private readonly farm: FarmService) {}

  @Get('overview')
  overview(@Req() req: FarmRequest) {
    return this.farm.overview(req.farm!);
  }

  @FarmRoles(...MANAGE)
  @Patch('settings')
  updateSettings(@Body() dto: UpdateFarmSettingsDto) {
    return this.farm.updateSettings(dto);
  }

  @Get('units')
  units() {
    return this.farm.listUnits();
  }

  @FarmRoles(...MANAGE)
  @Post('units')
  createUnit(@Req() req: FarmRequest, @Body() dto: CreateFarmUnitDto) {
    return this.farm.createUnit(req.farm!, dto);
  }

  @FarmRoles(...MANAGE)
  @Patch('units/:id')
  updateUnit(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFarmUnitDto) {
    return this.farm.updateUnit(req.farm!, id, dto);
  }

  @Get('enterprises')
  enterprises() {
    return this.farm.listEnterprises();
  }

  @FarmRoles(...MANAGE)
  @Post('enterprises')
  createEnterprise(@Body() dto: CreateFarmEnterpriseDto) {
    return this.farm.createEnterprise(dto);
  }

  @FarmRoles(...MANAGE)
  @Patch('enterprises/:id')
  updateEnterprise(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFarmEnterpriseDto) {
    return this.farm.updateEnterprise(id, dto);
  }

  @FarmRoles(...MANAGE)
  @Get('staff')
  staff() {
    return this.farm.listStaff();
  }

  /** Only the farm owner gives out farm roles. */
  @FarmRoles(FarmRoleCode.FARM_OWNER)
  @Put('staff/:orgUserId/roles')
  setRoles(@Req() req: FarmRequest, @Param('orgUserId', ParseUUIDPipe) orgUserId: string, @Body() dto: SetFarmRolesDto) {
    return this.farm.setRoles(req.farm!, orgUserId, dto);
  }
}

/** The Shamba price list for the welcome and pricing pages (no sign-in). */
@Controller('public/farm-plans')
export class PublicFarmPlansController {
  constructor(private readonly setup: FarmSetupService) {}

  @Public()
  @Get()
  plans() {
    return this.setup.activePlans();
  }
}
