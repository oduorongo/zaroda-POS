import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryItemsService } from './inventory-items.service';
import { InventoryTransactionsService } from './inventory-transactions.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryItemsService, InventoryTransactionsService],
  exports: [InventoryTransactionsService],
})
export class InventoryModule {}
