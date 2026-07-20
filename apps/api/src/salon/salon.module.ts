import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { SalonResourcesController } from './salon-resources.controller';
import { SalonAppointmentsController } from './salon-appointments.controller';
import { SalonResourcesService } from './salon-resources.service';
import { SalonAppointmentsService } from './salon-appointments.service';

/**
 * DESIGN.md's remaining Phase 5+ vertical: appointment/resource
 * scheduling. First slice only - booking, double-booking prevention, and
 * a status lifecycle. No transactionExtensions/hooks into core yet:
 * unlike restaurant/pharmacy, scheduling doesn't need to touch
 * SalesService at all for this slice. Linking a completed appointment to
 * a checkout sale (the same "module calls into core" pattern already
 * proven twice) is a natural follow-up, not folded into this one.
 */
@Module({
  imports: [ModuleRegistryModule],
  controllers: [SalonResourcesController, SalonAppointmentsController],
  providers: [SalonResourcesService, SalonAppointmentsService],
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
      ],
    });
  }
}
