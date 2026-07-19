import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [InventoryModule, CustomersModule],
  controllers: [SalesController],
  providers: [SalesService],
  // Exported so RestaurantModule (and future vertical modules) can call
  // into sale completion directly, per DESIGN.md §3's "modules depend on
  // core" rule - not previously needed since nothing outside this module
  // called SalesService before Phase 4.
  exports: [SalesService],
})
export class SalesModule {}
