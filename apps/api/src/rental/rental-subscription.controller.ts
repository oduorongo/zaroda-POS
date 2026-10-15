import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PayPlatformInvoiceDto } from './dto/rental-platform-invoice.dto';
import { RentalPlatformBillingService } from './rental-platform-billing.service';
import { RentalPlatformPaymentsService } from './rental-platform-payments.service';

// Each call can start an M-Pesa prompt on a real phone.
const PAY_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * The landlord's ZARODA rental invoices, and paying them. Deliberately NOT behind RentalReadOnlyInterceptor: an
 * account that has been made read-only must still be able to see what it owes - and pay it.
 */
@Controller('rental/subscription')
@Roles(Role.MANAGER, Role.OWNER)
export class RentalSubscriptionController {
  constructor(
    private readonly billing: RentalPlatformBillingService,
    private readonly payments: RentalPlatformPaymentsService,
  ) {}

  @Get()
  async mine() {
    return { ...(await this.billing.getMine()), canPayOnline: this.payments.canPayOnline() };
  }

  // Pay an invoice with M-Pesa through ZARODA's own Tuma account.
  @Throttle(PAY_THROTTLE)
  @Post('invoices/:id/pay')
  @HttpCode(200)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayPlatformInvoiceDto) {
    return this.payments.payOnline(id, dto.phone);
  }

  // The screen polls this while it waits for the PIN (free reads; the "check now" Tuma call is rate limited).
  @Post('invoices/:id/check')
  @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.checkPayment(id);
  }
}
