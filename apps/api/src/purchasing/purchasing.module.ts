import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { SupplierBillsController } from './supplier-bills.controller';
import { SupplierBillsService } from './supplier-bills.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [SuppliersController, PurchaseOrdersController, GoodsReceiptsController, SupplierBillsController],
  providers: [SuppliersService, PurchaseOrdersService, GoodsReceiptsService, SupplierBillsService],
  // Construction LPOs are purchase orders to a project site branch (construction/materials).
  exports: [PurchaseOrdersService],
})
export class PurchasingModule {}
