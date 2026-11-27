import { Module, OnModuleInit } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { MpesaB2cClient } from '../sales-teams/mpesa-b2c.client';
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
import { FarmCropsController } from './farm-crops.controller';
import { FarmCropsService } from './farm-crops.service';
import { FarmFeedController } from './farm-feed.controller';
import { FarmFeedService } from './farm-feed.service';
import { FarmLabourController, FarmSalesController, FarmWagesCallbackController } from './farm-labour-sales.controller';
import { FarmLabourService } from './farm-labour.service';
import { FarmSalesService } from './farm-sales.service';
import { FarmReportsController } from './farm-reports.controller';
import { FarmReportsService } from './farm-reports.service';
import { FarmValuationController } from './farm-valuation.controller';
import { FarmInputsController } from './farm-inputs.controller';
import { FarmInputsService } from './farm-inputs.service';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { FarmValuationService } from './farm-valuation.service';
import { FarmBillingCallbackController, FarmBillingController } from './farm-billing.controller';
import { FarmBillingService } from './farm-billing.service';

/** Zaroda Shamba - farm management (industryType FARM). docs/farm, prompts/farm. */
@Module({
  imports: [NotificationsModule, InventoryModule, ModuleRegistryModule, OnlineStoreModule, PurchasingModule],
  controllers: [
    FarmController, FarmLivestockController, FarmProductionController, FarmCropsController, FarmFeedController, FarmLabourController, FarmSalesController,
    FarmWagesCallbackController, FarmReportsController, FarmValuationController, FarmInputsController, FarmBillingController, FarmBillingCallbackController, PublicFarmPlansController,
  ],
  providers: [
    FarmService, FarmSetupService, FarmGuard, FarmLivestockService, FarmHealthService, FarmRemindersService, FarmProductionService, FarmCropsService, FarmFeedService,
    FarmLabourService, FarmSalesService, FarmReportsService, FarmValuationService, FarmInputsService, FarmBillingService, MpesaB2cClient,
  ],
  exports: [FarmSetupService, FarmBillingService],
})
export class FarmModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly sales: FarmSalesService,
  ) {}

  /** The till refuses to sell farm milk and eggs beyond the fit-for-sale stock (withheld produce never enters stock). */
  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'FARM',
      entityExtensions: [{ tableName: 'farm_produce_settings', description: 'Which products hold a farm\'s milk and eggs (fit for sale only)' }],
      hooks: [{ event: 'inventory.beforeDecrement', handler: this.sales.beforeDecrement.bind(this.sales) }],
    });
  }
}
