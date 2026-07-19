import { Module } from '@nestjs/common';
import { StockTakesController } from './stock-takes.controller';
import { StockTakesService } from './stock-takes.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [StockTakesController],
  providers: [StockTakesService],
})
export class StockTakesModule {}
