import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';
import { CreatePlanDto, UpdatePlanDto } from './dto/create-plan.dto';
import { OnboardTenantDto } from './dto/onboard-tenant.dto';
import { RecordPaymentDto, SetSuspensionDto } from './dto/record-payment.dto';

// Same throttle shape as tenant login (auth.controller.ts) - this is the
// one public, pre-JWT endpoint on this controller.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

// Every route below @Public() + @UseGuards(PlatformAdminAuthGuard)
// explicitly, rather than relying on the app-wide JwtAuthGuard/RolesGuard
// (see PlatformAdminAuthGuard's own comment) - those two guards assume
// the tenant JWT payload shape (organizationId/role) and have no concept
// of a platform admin at all.
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly auth: PlatformAdminAuthService,
    private readonly platformAdmin: PlatformAdminService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/login')
  login(@Body() dto: PlatformAdminLoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations')
  async listOrganizations(@Req() req: PlatformAdminRequest) {
    const result = await this.platformAdmin.listOrganizations();
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.listed_organizations',
      entityType: 'Organization',
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations/:id')
  async getOrganization(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.platformAdmin.getOrganization(id);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.viewed_organization',
      entityType: 'Organization',
      entityId: id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('tenants')
  async onboardTenant(
    @Req() req: PlatformAdminRequest,
    @Body() dto: OnboardTenantDto,
  ) {
    const result = await this.platformAdmin.onboardTenant(dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.onboarded_tenant',
      entityType: 'Organization',
      entityId: result.organizationId,
      organizationId: result.organizationId,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('plans')
  listPlans() {
    return this.platformAdmin.listPlans();
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('plans')
  async createPlan(
    @Req() req: PlatformAdminRequest,
    @Body() dto: CreatePlanDto,
  ) {
    const result = await this.platformAdmin.createPlan(dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.created_plan',
      entityType: 'Plan',
      entityId: result.id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('plans/:id')
  async updatePlan(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    const result = await this.platformAdmin.updatePlan(id, dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.updated_plan',
      entityType: 'Plan',
      entityId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/payments')
  async recordPayment(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    const result = await this.platformAdmin.recordPayment(
      id,
      dto,
      req.user!.platformAdminId,
    );
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.recorded_payment',
      entityType: 'Subscription',
      entityId: result.subscription.id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/suspension')
  async setSuspension(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSuspensionDto,
  ) {
    const result = await this.platformAdmin.setSuspension(id, dto.suspended);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: dto.suspended
        ? 'platform_admin.suspended_tenant'
        : 'platform_admin.reactivated_tenant',
      entityType: 'Subscription',
      entityId: result.id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('analytics')
  analytics() {
    return this.platformAdmin.analytics();
  }
}
