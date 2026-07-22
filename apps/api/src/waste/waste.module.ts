import { Module } from '@nestjs/common';
import { WasteController } from './waste.controller';
import { WasteService } from './waste.service';
import { InventoryModule } from '../inventory/inventory.module';
import { RecipesModule } from '../recipes/recipes.module';

@Module({
  imports: [InventoryModule, RecipesModule],
  controllers: [WasteController],
  providers: [WasteService],
})
export class WasteModule {}
