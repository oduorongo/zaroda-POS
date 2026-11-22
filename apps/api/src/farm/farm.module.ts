import { Module } from '@nestjs/common';
import { FarmController, PublicFarmPlansController } from './farm.controller';
import { FarmGuard } from './farm-access';
import { FarmService } from './farm.service';
import { FarmSetupService } from './farm-setup.service';

/** Zaroda Shamba - farm management (industryType FARM). docs/farm, prompts/farm. */
@Module({
  controllers: [FarmController, PublicFarmPlansController],
  providers: [FarmService, FarmSetupService, FarmGuard],
  exports: [FarmSetupService],
})
export class FarmModule {}
