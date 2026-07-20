import { Module, OnModuleInit } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { SalonResourcesController } from './salon-resources.controller';
import { SalonAppointmentsController } from './salon-appointments.controller';
import { SalonResourcesService } from './salon-resources.service';
import { SalonAppointmentsService } from './salon-appointments.service';
import { SalonAppointmentSalesService } from './salon-appointment-sales.service';

/**
 * DESIGN.md's remaining Phase 5+ vertical: appointment/resource
 * scheduling, plus checkout - linking a completed appointment to a
 * checkout sale, the same "module calls into core" pattern already
 * proven twice (restaurant, pharmacy). This module imports SalesModule
 * directly (SalonAppointmentSalesService calls SalesService.create()) -
 * core imports nothing from here.
 */
@Module({
  imports: [SalesModule, ModuleRegistryModule],
  controllers: [SalonResourcesController, SalonAppointmentsController],
  providers: [
    SalonResourcesService,
    SalonAppointmentsService,
    SalonAppointmentSalesService,
  ],
})
export class SalonModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      industryType: 'SALON',
      entityExtensions: [
        {
          tableName: 'salon_resources',
          description: 'Bookable resources (stylist, chair, room...)',
        },
        {
          tableName: 'salon_appointments',
          description:
            'A scheduled booking against a resource, with double-booking prevention',
        },
        {
          tableName: 'salon_appointment_sales',
          description: 'Links a checkout sale to the appointment it was for',
        },
      ],
    });
  }
}
