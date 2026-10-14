import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { CommissionService } from './commission.service';

export class PayInvoiceDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

// Each call can start an M-Pesa prompt - throttled like the TUMA connect.
const PAY_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/** Tuma's payment webhook for commission invoices. Authenticated by the HMAC in the URL, and even then only a prompt to ask Tuma - see CommissionService.handleTumaCallback. */
@Controller('public/commission')
export class CommissionCallbackController {
  constructor(private readonly commission: CommissionService) {}

  @Public()
  @Post(':organizationId/:invoiceId/tuma-callback/:token')
  @HttpCode(200)
  callback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('token') token: string,
    // Tuma's real payload has fields we don't model, so this stays untyped
    // (a class would be rejected by the global forbidNonWhitelisted pipe).
    @Body() body: Record<string, unknown>,
  ) {
    return this.commission.handleTumaCallback(organizationId, invoiceId, token, body);
  }
}

export { PAY_THROTTLE };
