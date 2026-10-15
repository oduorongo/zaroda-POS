import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { RentalPlatformPaymentsService } from './rental-platform-payments.service';

/**
 * Tuma's payment webhook for a landlord's ZARODA rental invoice. Authenticated by the HMAC in the URL, and even then
 * only trusted once the body is complete and consistent - see RentalPlatformPaymentsService.handleTumaCallback.
 */
@Controller('public/rental-platform')
export class RentalPlatformCallbackController {
  constructor(private readonly payments: RentalPlatformPaymentsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':organizationId/:invoiceId/tuma-callback/:token')
  @HttpCode(200)
  callback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('token') token: string,
    // Tuma's real payload has fields we do not model, so this stays untyped
    // (a class would be rejected by the global forbidNonWhitelisted pipe).
    @Body() body: Record<string, unknown>,
  ) {
    return this.payments.handleTumaCallback(organizationId, invoiceId, token, body);
  }
}
