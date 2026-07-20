import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryItemsService } from './inventory-items.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { BatchesService } from './batches.service';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryItemsService,
    InventoryTransactionsService,
    BatchesService,
  ],
  exports: [InventoryTransactionsService],
})
export class InventoryModule {}
