import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FarmController, PublicFarmPlansController } from './farm.controller';
import { FarmGuard } from './farm-access';
import { FarmService } from './farm.service';
import { FarmSetupService } from './farm-setup.service';
import { FarmLivestockController } from './farm-livestock.controller';
import { FarmLivestockService } from './farm-livestock.service';
import { FarmHealthService } from './farm-health.service';
import { FarmRemindersService } from './farm-reminders.service';

/** Zaroda Shamba - farm management (industryType FARM). docs/farm, prompts/farm. */
@Module({
  imports: [NotificationsModule],
  controllers: [FarmController, FarmLivestockController, PublicFarmPlansController],
  providers: [FarmService, FarmSetupService, FarmGuard, FarmLivestockService, FarmHealthService, FarmRemindersService],
  exports: [FarmSetupService],
})
export class FarmModule {}
