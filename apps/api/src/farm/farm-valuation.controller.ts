import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { UpdateValuationSettingsDto } from './dto/valuation.dto';
import { FarmValuationService } from './farm-valuation.service';

const { FARM_MANAGER, AUDITOR } = FarmRoleCode;

/** Suggested selling prices for animals and flocks (with basic reports), and the rates behind them. */
@Farm()
@FarmFeature('reports_basic')
@FarmRoles(FARM_MANAGER, AUDITOR)
@Controller('farm/valuation')
export class FarmValuationController {
  constructor(private readonly valuation: FarmValuationService) {}

  @Get()
  list(@Req() req: FarmRequest) {
    return this.valuation.list(req.farm!);
  }

  @Get('settings')
  settings() {
    return this.valuation.settings();
  }

  @FarmRoles(FARM_MANAGER)
  @Put('settings')
  update(@Body() dto: UpdateValuationSettingsDto) {
    return this.valuation.updateSettings(dto);
  }
}
