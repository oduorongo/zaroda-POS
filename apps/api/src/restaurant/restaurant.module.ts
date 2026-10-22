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
import { RestaurantDishesController } from './restaurant-dishes.controller';
import { RestaurantDishesService } from './restaurant-dishes.service';
import { RestaurantTabsController } from './restaurant-tabs.controller';
import { RestaurantTabsService } from './restaurant-tabs.service';
import { RestaurantTabPaymentsService } from './restaurant-tab-payments.service';

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
    RestaurantDishesController,
    RestaurantTabsController,
  ],
  providers: [
    RestaurantTablesService,
    RestaurantSalesService,
    KitchenStationsService,
    KitchenTicketsService,
    RestaurantHooksService,
    RestaurantDishesService,
    RestaurantTabsService,
    RestaurantTabPaymentsService,
  ],
})
export class RestaurantModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly hooks: RestaurantHooksService,
  ) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
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
          tableName: 'hotel_room_types',
          description: 'Hotel room types (a kind of room, its nightly price and how many there are) advertised on the marketplace',
        },
        {
          tableName: 'hotel_room_photos',
          description: 'Photos of a hotel room type',
        },
        {
          tableName: 'room_bookings',
          description: 'A guest booking of one or more rooms for dates, with the deposit paid online',
        },
        {
          tableName: 'table_reservations',
          description: 'A guest\'s request for a table at a date and time, confirmed or declined by the restaurant',
        },
        {
          tableName: 'restaurant_dishes',
          description: 'Which kitchen station prepares each dish, for orders from a table QR code',
        },
        {
          tableName: 'restaurant_tabs',
          description: 'A running bill for a table, paid at the end in one or several sales',
        },
        {
          tableName: 'restaurant_tab_lines',
          description: 'Items on an open bill, each sent to a kitchen station',
        },
        {
          tableName: 'restaurant_tab_sales',
          description: 'The sales that paid a bill (several when it was split)',
        },
        {
          tableName: 'restaurant_settings',
          description: 'Per-branch restaurant settings (how early a reserved table shows as reserved)',
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
        {
          event: 'refund.afterApproved',
          handler: this.hooks.onRefundAfterApproved.bind(this.hooks),
        },
      ],
    });
  }
}
