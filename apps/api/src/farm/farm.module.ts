import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FarmController, PublicFarmPlansController } from './farm.controller';
import { FarmGuard } from './farm-access';
import { FarmService } from './farm.service';
import { FarmSetupService } from './farm-setup.service';
import { FarmLivestockController } from './farm-livestock.controller';
import { FarmLivestockService } from './farm-livestock.service';
import { FarmHealthService } from './farm-health.service';
import { FarmRemindersService } from './farm-reminders.service';
import { FarmProductionController } from './farm-production.controller';
import { FarmProductionService } from './farm-production.service';

/** Zaroda Shamba - farm management (industryType FARM). docs/farm, prompts/farm. */
@Module({
  imports: [NotificationsModule, InventoryModule],
  controllers: [FarmController, FarmLivestockController, FarmProductionController, PublicFarmPlansController],
  providers: [FarmService, FarmSetupService, FarmGuard, FarmLivestockService, FarmHealthService, FarmRemindersService, FarmProductionService],
  exports: [FarmSetupService],
})
export class FarmModule {}
