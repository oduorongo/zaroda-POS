import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { StockSyncController } from './stock-sync.controller';
import { StockSyncService } from './stock-sync.service';

@Module({
  imports: [InventoryModule],
  controllers: [StockSyncController],
  providers: [StockSyncService],
})
export class StockSyncModule {}
