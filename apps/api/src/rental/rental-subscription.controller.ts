import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RentalPlatformBillingService } from './rental-platform-billing.service';

/**
 * The landlord's ZARODA rental invoices. Deliberately NOT behind RentalReadOnlyInterceptor: an account that has been
 * made read-only must still be able to see what it owes.
 */
@Controller('rental/subscription')
@Roles(Role.MANAGER, Role.OWNER)
export class RentalSubscriptionController {
  constructor(private readonly billing: RentalPlatformBillingService) {}

  @Get()
  mine() {
    return this.billing.getMine();
  }
}
