import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { RentalController } from './rental.controller';
import { RentalService } from './rental.service';
import { RentalBillingService } from './rental-billing.service';
import { RentalSchedulerService } from './rental-scheduler.service';

/**
 * Rental / property management for landlords (industryType "RENTAL").
 * Like the restaurant module it imports nothing that core imports back,
 * and registers a manifest at bootstrap.
 */
@Module({
  imports: [ModuleRegistryModule],
  controllers: [RentalController],
  providers: [RentalService, RentalBillingService, RentalSchedulerService],
})
export class RentalModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'RENTAL',
      entityExtensions: [
        { tableName: 'rental_properties', description: 'Buildings a landlord owns or manages' },
        { tableName: 'rental_units', description: 'Lettable units (houses, rooms, shops) in a property' },
        { tableName: 'rental_tenants', description: 'People renting units' },
        { tableName: 'rental_leases', description: 'A tenant renting a unit, with rent, deposit and due day' },
        { tableName: 'rental_invoices', description: 'Monthly rent, deposit and one-off charges owed by a tenant' },
        { tableName: 'rental_payments', description: 'Money received from tenants, with receipt numbers' },
        { tableName: 'rental_payment_allocations', description: 'Which invoice each payment was applied to' },
      ],
    });
  }
}
