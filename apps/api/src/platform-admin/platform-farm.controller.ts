import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { FarmBillingService } from '../farm/farm-billing.service';
import { ExtendFarmTrialDto, RecordFarmPaymentDto, UpdateFarmPlanDto } from '../farm/dto/billing.dto';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAuditLogService } from './platform-audit-log.service';

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** ZARODA's Shamba plans: edit the price list, see farms and MRR, extend trials, record payments made outside M-Pesa. */
@Controller('platform-admin/farm')
@Public()
@UseGuards(PlatformAdminAuthGuard)
export class PlatformFarmController {
  constructor(
    private readonly billing: FarmBillingService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  private log(req: PlatformAdminRequest, action: string, entityType: string, entityId?: string, organizationId?: string) {
    return this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: `platform_admin.${action}`, entityType, entityId, organizationId });
  }

  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Patch('plans/:code')
  async updatePlan(@Req() req: PlatformAdminRequest, @Param('code') code: string, @Body() dto: UpdateFarmPlanDto) {
    const { after } = await this.billing.updatePlan(code, dto);
    await this.log(req, 'updated_farm_plan', 'FarmPlan', after.id);
    return after;
  }

  @Get('tenants')
  async tenants(@Req() req: PlatformAdminRequest) {
    await this.log(req, 'listed_farm_tenants', 'FarmSubscription');
    return this.billing.tenants();
  }

  @Post('tenants/:id/extend-trial')
  async extendTrial(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendFarmTrialDto) {
    const after = await this.billing.extendTrial(id, dto.days);
    await this.log(req, 'extended_farm_trial', 'FarmSubscription', after.id, id);
    return after;
  }

  @Post('tenants/:id/payments')
  async record(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordFarmPaymentDto) {
    const p = await this.billing.recordPayment(id, dto, req.user!.platformAdminId);
    await this.log(req, 'recorded_farm_payment', 'FarmSubscriptionPayment', p.id, id);
    return p;
  }
}
