import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { MarkInstalmentPaidDto, SeasonalSettingsDto, ShiftDueDateDto } from '../seasonal-billing/dto/seasonal.dto';
import { SeasonalBillingService } from '../seasonal-billing/seasonal-billing.service';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAuditLogService } from './platform-audit-log.service';

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** Seasonal (school-term) billing for the platform admin: the terms and settings, moving a due date for everyone, recording a payment. */
@Controller('platform-admin/seasonal')
@Public()
@UseGuards(PlatformAdminAuthGuard)
export class PlatformSeasonalController {
  constructor(
    private readonly seasonal: SeasonalBillingService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  @Get('settings')
  settings() {
    return this.seasonal.settings();
  }

  @Patch('settings')
  async updateSettings(@Req() req: PlatformAdminRequest, @Body() dto: SeasonalSettingsDto) {
    const result = await this.seasonal.updateSettings(dto, req.user!.platformAdminId);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.seasonal_settings_updated', entityType: 'SeasonalBillingSettings', entityId: 'default' });
    return result;
  }

  @Get('businesses')
  businesses() {
    return this.seasonal.overview();
  }

  @Post('shift-due-date')
  @HttpCode(200)
  async shift(@Req() req: PlatformAdminRequest, @Body() dto: ShiftDueDateDto) {
    const result = await this.seasonal.shiftDueDate(dto, req.user!.platformAdminId);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.seasonal_due_date_shifted', entityType: 'SeasonalDueShift', entityId: `${dto.schoolYear}-T${dto.term}` });
    return result;
  }

  @Post('organizations/:id/instalments/:instalmentId/payment')
  @HttpCode(200)
  async markPaid(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('instalmentId', ParseUUIDPipe) instalmentId: string,
    @Body() dto: MarkInstalmentPaidDto,
  ) {
    const result = await this.seasonal.markPaid(id, instalmentId, dto, req.user!.platformAdminId);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.seasonal_instalment_paid', entityType: 'SubscriptionInstalment', entityId: instalmentId, organizationId: id });
    return result;
  }
}
