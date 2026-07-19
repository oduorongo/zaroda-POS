import { Module } from '@nestjs/common';
import { LayawaysController } from './layaways.controller';
import { LayawaysService } from './layaways.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [InventoryModule, CustomersModule],
  controllers: [LayawaysController],
  providers: [LayawaysService],
})
export class LayawaysModule {}
