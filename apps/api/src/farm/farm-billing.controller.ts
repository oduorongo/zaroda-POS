import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Farm, FarmRoles, FarmWriteWhenSuspended } from './farm-access';
import { FarmBillingService } from './farm-billing.service';
import { BuyFarmSmsDto, PayFarmFeesDto, PayFarmPlanDto } from './dto/billing.dto';

/** A farm's plan with ZARODA: what it is on, paying for it, SMS bundles and the monthly fees. Works while the plan has lapsed. */
@Farm()
@FarmRoles(FarmRoleCode.FARM_MANAGER)
@FarmWriteWhenSuspended()
@Controller('farm/plan')
export class FarmBillingController {
  constructor(private readonly billing: FarmBillingService) {}

  @Get()
  overview() {
    return this.billing.overview();
  }

  @Post('pay')
  pay(@Body() dto: PayFarmPlanDto) {
    return this.billing.payPlan(dto);
  }

  @Post('sms')
  sms(@Body() dto: BuyFarmSmsDto) {
    return this.billing.buySms(dto);
  }

  @Post('fees/:id/pay')
  fees(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayFarmFeesDto) {
    return this.billing.payFees(id, dto);
  }

  @Get('payments/:id')
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.checkPayment(id);
  }
}

/** Tuma's answer for a farm's payment to ZARODA. The URL carries the payment and a token made from it. */
@Public()
@Controller('public/farm-billing')
export class FarmBillingCallbackController {
  constructor(private readonly billing: FarmBillingService) {}

  @HttpCode(200)
  @Post(':organizationId/:paymentId/tuma-callback/:token')
  callback(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Param('token') token: string, @Body() body: Record<string, unknown>) {
    return this.billing.handleTumaCallback(organizationId, paymentId, token, body ?? {});
  }
}
