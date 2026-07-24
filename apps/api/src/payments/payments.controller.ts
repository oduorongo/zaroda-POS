import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PaymentsService } from './payments.service';
import { InitiateMpesaDto } from './dto/initiate-mpesa.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('mpesa/initiate')
  initiateMpesa(@Body() dto: InitiateMpesaDto) {
    return this.payments.initiateMpesa(dto);
  }

  @Get('mpesa/status/:checkoutRequestId')
  getMpesaStatus(@Param('checkoutRequestId') checkoutRequestId: string) {
    return this.payments.getMpesaStatus(checkoutRequestId);
  }

  // Safaricom's webhook - unauthenticated by nature (see
  // PaymentsService.handleMpesaCallback for how tenant context is derived
  // from the URL instead of a JWT). Throttled the same way other
  // unauthenticated write endpoints are (auth.controller.ts,
  // public-booking.controller.ts) since it's a write reachable with no
  // token at all.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('mpesa/callback/:organizationId')
  mpesaCallback(
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.payments.handleMpesaCallback(
      organizationId,
      body as Parameters<PaymentsService['handleMpesaCallback']>[1],
    );
  }
}
