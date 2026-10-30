import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { ApplyCouponDto, CouponDto, ExtendTrialDto, RecordConPaymentDto, UpdateConPlanDto } from '../construction/dto/construction.dto';
import { ConPlansService } from '../construction/plans/con-plans.service';
import { ComplianceAlertsService } from '../construction/compliance/compliance-alerts.service';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAuditLogService } from './platform-audit-log.service';

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** ZARODA's construction plans: edit the price list and coupons, see tenants and MRR, extend trials, record payments. */
@Controller('platform-admin/construction')
@Public()
@UseGuards(PlatformAdminAuthGuard)
export class PlatformConstructionController {
  constructor(
    private readonly plans: ConPlansService,
    private readonly alerts: ComplianceAlertsService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  private log(req: PlatformAdminRequest, action: string, entityType: string, entityId?: string, organizationId?: string) {
    return this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: `platform_admin.${action}`, entityType, entityId, organizationId });
  }

  @Get('plans')
  listPlans() {
    return this.plans.listPlans();
  }

  @Patch('plans/:code')
  async updatePlan(@Req() req: PlatformAdminRequest, @Param('code') code: string, @Body() dto: UpdateConPlanDto) {
    const { after } = await this.plans.updatePlan(code, dto);
    await this.log(req, 'updated_con_plan', 'ConPlan', after.id);
    return after;
  }

  @Get('coupons')
  listCoupons() {
    return this.plans.listCoupons();
  }

  @Post('coupons')
  async saveCoupon(@Req() req: PlatformAdminRequest, @Body() dto: CouponDto) {
    const row = await this.plans.saveCoupon(dto);
    await this.log(req, 'saved_con_coupon', 'ConCoupon', row.id);
    return row;
  }

  // The expiry-alert pass the API runs every few hours, now.
  @Post('alerts/run')
  async runAlerts(@Req() req: PlatformAdminRequest) {
    const raised = await this.alerts.tick();
    await this.log(req, 'ran_con_alerts', 'ConAlert');
    return { raised };
  }

  @Get('tenants')
  async tenants(@Req() req: PlatformAdminRequest) {
    await this.log(req, 'listed_con_tenants', 'ConSubscription');
    return this.plans.tenants();
  }

  @Post('tenants/:id/extend-trial')
  async extendTrial(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendTrialDto) {
    const { after } = await this.plans.extendTrial(id, dto.days);
    await this.log(req, 'extended_con_trial', 'ConSubscription', after.id, id);
    return after;
  }

  @Post('tenants/:id/coupon')
  async applyCoupon(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyCouponDto) {
    const { after } = await this.plans.applyCoupon(id, dto.code);
    await this.log(req, 'applied_con_coupon', 'ConSubscription', after.id, id);
    return after;
  }

  @Post('tenants/:id/payments')
  async recordPayment(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordConPaymentDto) {
    const payment = await this.plans.recordPayment(id, dto, req.user!.platformAdminId);
    await this.log(req, 'recorded_con_payment', 'ConSubscriptionPayment', payment.id, id);
    return payment;
  }
}
