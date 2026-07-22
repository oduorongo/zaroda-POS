import { Module, OnModuleInit } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { RecipesModule } from '../recipes/recipes.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';

/**
 * The manufacturing vertical: raw materials transformed into finished
 * goods for sale (bakery, brick-making...). Reuses the recipe module's
 * RecipeIngredient rows as the bill of materials and InventoryModule's
 * atomic transaction recorder to move stock - no new BOM or stock-movement
 * primitive of its own, same "module composes core" contract as
 * restaurant/salon (DESIGN.md §3). Core imports nothing from here.
 */
@Module({
  imports: [InventoryModule, RecipesModule, ModuleRegistryModule],
  controllers: [ProductionOrdersController],
  providers: [ProductionOrdersService],
})
export class ManufacturingModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'MANUFACTURING',
      entityExtensions: [
        {
          tableName: 'production_orders',
          description:
            'A finished-good production run against its recipe (BOM) - consumes raw materials, yields the finished good',
        },
      ],
    });
  }
}
