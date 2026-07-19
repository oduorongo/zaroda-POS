import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [InventoryModule, CustomersModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
