import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { PayInstalmentDto } from './dto/seasonal.dto';
import { SeasonalBillingService } from './seasonal-billing.service';
import { SeasonalPaymentsService } from './seasonal-payments.service';

/** The business's own subscription ("My subscription"): open even while read-only, so it can always be seen and paid. */
@Controller('subscription/seasonal')
@Roles(Role.MANAGER, Role.OWNER)
export class SeasonalBillingController {
  constructor(
    private readonly billing: SeasonalBillingService,
    private readonly payments: SeasonalPaymentsService,
  ) {}

  @Get()
  async mine() {
    return { ...(await this.billing.mine()), canPayOnline: this.payments.canPayOnline() };
  }

  // Each call can start an M-Pesa prompt on a real phone.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('instalments/:id/pay')
  @HttpCode(200)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayInstalmentDto) {
    return this.payments.payOnline(id, dto.phone, !!dto.fullYear);
  }

  @Post('instalments/:id/check')
  @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.checkPayment(id);
  }
}

/** Tuma's webhook for an instalment payment, authenticated by the HMAC in the URL. */
@Controller('public/seasonal-billing')
export class SeasonalCallbackController {
  constructor(private readonly payments: SeasonalPaymentsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':organizationId/:id/tuma-callback/:token')
  @HttpCode(200)
  callback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.payments.handleTumaCallback(organizationId, id, token, body);
  }
}
