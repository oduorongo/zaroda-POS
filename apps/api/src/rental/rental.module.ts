import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { RentalTenantAuthService } from './portal/rental-tenant-auth.service';
import { RentalTenantAuthController, RentalTenantPortalController } from './portal/rental-tenant-portal.controller';
import { RentalTenantPortalService } from './portal/rental-tenant-portal.service';
import { RentalTenantJwtStrategy } from './portal/tenant-auth';
import { RentalController } from './rental.controller';
import { RentalOpsController } from './rental-ops.controller';
import { RentalOpsService } from './rental-ops.service';
import { RentalRemindersService } from './rental-reminders.service';
import { RentalReportService } from './rental-report.service';
import { RentalCallbackController, RentalMpesaController } from './rental-mpesa.controller';
import { RentalMpesaService } from './rental-mpesa.service';
import { RentalService } from './rental.service';
import { RentalPlansService } from './rental-plans.service';
import { RentalBillingService } from './rental-billing.service';
import { RentalSchedulerService } from './rental-scheduler.service';

/**
 * Rental / property management for landlords (industryType "RENTAL").
 * Like the restaurant module it imports nothing that core imports back,
 * and registers a manifest at bootstrap.
 */
@Module({
  imports: [
    ModuleRegistryModule,
    OnlineStoreModule,
    PassportModule,
    // Tenant tokens share the buyer secret and are told apart by their scope claim (see portal/tenant-auth.ts).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('RENTAL_TENANT_JWT_EXPIRES_IN') ?? '30d' },
      }),
    }),
  ],
  controllers: [RentalController, RentalTenantAuthController, RentalTenantPortalController, RentalOpsController, RentalMpesaController, RentalCallbackController],
  providers: [
    RentalService,
    RentalPlansService,
    RentalBillingService,
    RentalMpesaService,
    RentalOpsService,
    RentalReportService,
    RentalRemindersService,
    RentalSchedulerService,
    RentalTenantJwtStrategy,
    RentalTenantAuthService,
    RentalTenantPortalService,
  ],
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
        { tableName: 'rental_settings', description: 'How a landlord collects rent by M-Pesa (Tuma or own Paybill/Till), keys encrypted' },
        { tableName: 'rental_payment_requests', description: 'M-Pesa prompts sent to tenants and how they ended' },
        { tableName: 'rental_maintenance_requests', description: 'Repairs and problems reported on a property or unit' },
        { tableName: 'rental_expenses', description: 'Money spent on a property, for profit reporting' },
        { tableName: 'rental_meter_readings', description: 'Water and electricity readings billed to tenants' },
        { tableName: 'rental_reminder_logs', description: 'Which rent reminders were sent, so none repeats' },
        { tableName: 'rental_tenant_otps', description: 'One-time email sign-in codes for tenants' },
        { tableName: 'rental_payment_allocations', description: 'Which invoice each payment was applied to' },
      ],
    });
  }
}
