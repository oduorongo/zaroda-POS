import { Module, OnModuleInit } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { PharmacyHooksService } from './pharmacy-hooks.service';
import { PharmacyProductFlagsService } from './pharmacy-product-flags.service';
import { PharmacySalesService } from './pharmacy-sales.service';
import { PharmacyProductsController } from './pharmacy-products.controller';
import { PharmacySalesController } from './pharmacy-sales.controller';

/**
 * Phase 5's full pharmacy vertical: batch/expiry enforcement (first
 * slice) plus controlled-substance flags and prescription linkage (this
 * slice). This module imports SalesService directly
 * (PharmacySalesService calls it to complete a sale, exactly like
 * RestaurantSalesService does) - core imports nothing from here.
 */
@Module({
  imports: [SalesModule, ModuleRegistryModule],
  controllers: [PharmacyProductsController, PharmacySalesController],
  providers: [
    PharmacyHooksService,
    PharmacyProductFlagsService,
    PharmacySalesService,
  ],
})
export class PharmacyModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly hooks: PharmacyHooksService,
  ) {}

  onModuleInit() {
    this.registry.register({
      industryType: 'PHARMACY',
      entityExtensions: [
        {
          tableName: 'pharmacy_product_flags',
          description: 'Controlled-substance flag/classification for a product',
        },
        {
          tableName: 'pharmacy_sale_prescriptions',
          description: 'Prescription details linked to a sale',
        },
      ],
      hooks: [
        {
          event: 'inventory.beforeDecrement',
          handler: this.hooks.onInventoryBeforeDecrement.bind(this.hooks),
        },
      ],
    });
  }
}
