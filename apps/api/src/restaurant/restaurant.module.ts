import { Module, OnModuleInit } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { RestaurantTablesController } from './restaurant-tables.controller';
import { RestaurantSalesController } from './restaurant-sales.controller';
import { KitchenStationsController } from './kitchen-stations.controller';
import { KitchenTicketsController } from './kitchen-tickets.controller';
import { RestaurantTablesService } from './restaurant-tables.service';
import { RestaurantSalesService } from './restaurant-sales.service';
import { KitchenStationsService } from './kitchen-stations.service';
import { KitchenTicketsService } from './kitchen-tickets.service';
import { RestaurantHooksService } from './restaurant-hooks.service';

/**
 * Phase 4's proof that DESIGN.md §3's module contract actually works:
 * this module imports SalesService directly (RestaurantSalesService
 * calls it to complete a table's order) and registers a manifest with
 * ModuleRegistryService at bootstrap - core's own modules (SalesModule,
 * InventoryModule) import nothing from here, and nothing in core was
 * edited to add this vertical beyond the generic emit() calls already
 * wired for the hook mechanism in general (not for restaurant
 * specifically - see industry-module-manifest.interface.ts).
 */
@Module({
  imports: [SalesModule, ModuleRegistryModule],
  controllers: [
    RestaurantTablesController,
    RestaurantSalesController,
    KitchenStationsController,
    KitchenTicketsController,
  ],
  providers: [
    RestaurantTablesService,
    RestaurantSalesService,
    KitchenStationsService,
    KitchenTicketsService,
    RestaurantHooksService,
  ],
})
export class RestaurantModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly hooks: RestaurantHooksService,
  ) {}

  onModuleInit() {
    this.registry.register({
      industryType: 'RESTAURANT',
      entityExtensions: [
        {
          tableName: 'restaurant_tables',
          description: 'Dine-in tables/floor plan',
        },
        {
          tableName: 'restaurant_sale_tables',
          description: 'Links a completed sale to the table it was ordered at',
        },
        {
          tableName: 'restaurant_sale_tips',
          description: 'Tip/service charge collected alongside a sale',
        },
        {
          tableName: 'kitchen_stations',
          description: 'Prep areas (Grill, Bar, Cold...) orders route to',
        },
        {
          tableName: 'kitchen_tickets',
          description:
            'One ticket per (sale, station, course) - the KDS unit of work',
        },
      ],
      hooks: [
        {
          event: 'sale.afterComplete',
          handler: this.hooks.onSaleAfterComplete.bind(this.hooks),
        },
      ],
    });
  }
}
