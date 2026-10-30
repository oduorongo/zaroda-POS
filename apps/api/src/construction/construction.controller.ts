import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConRoleCode } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { ConFeature, ConRequest, ConRoles, ConWriteWhenSuspended, ConstructionGuard } from './common/con-access';
import { ComplianceAlertsService } from './compliance/compliance-alerts.service';
import { ComplianceService, MAX_DOC_BYTES } from './compliance/compliance.service';
import { ConstructionService } from './construction.service';
import {
  AddConStaffDto,
  CapCheckDto,
  CategoryLimitDto,
  ComplianceDocDto,
  PayPlanDto,
  QuoteQueryDto,
  RegistrationDto,
  RoleLimitDto,
  SetUserRolesDto,
  TaxSettingDto,
} from './dto/construction.dto';
import { ConPlansService } from './plans/con-plans.service';
import { ConSetupService } from './common/con-setup.service';
import { TRIAL_DAYS, TRIAL_PLAN } from './common/con-defaults';
import { CON_FEATURES } from './plans/con-plans.util';

const VIEW_COMPLIANCE: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER'];
const INTERNAL: ConRoleCode[] = [...VIEW_COMPLIANCE, 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER', 'CON_TIMEKEEPER'];
const UPLOAD_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

// Director/owner always passes @ConRoles (see hasRole).
@Controller('construction')
@UseGuards(ConstructionGuard)
export class ConstructionController {
  constructor(
    private readonly construction: ConstructionService,
    private readonly compliance: ComplianceService,
    private readonly alerts: ComplianceAlertsService,
    private readonly plans: ConPlansService,
  ) {}

  @Get('me')
  me(@Req() req: ConRequest) {
    return this.construction.me(req.con!);
  }

  @Get('dashboard')
  dashboard(@Req() req: ConRequest) {
    return this.construction.dashboard(req.con!);
  }

  @ConRoles(...INTERNAL)
  @Get('alerts')
  listAlerts() {
    return this.alerts.list();
  }

  @ConRoles(...INTERNAL)
  @ConWriteWhenSuspended()
  @Post('alerts/read')
  @HttpCode(200)
  readAll() {
    return this.alerts.markRead();
  }

  @ConRoles(...INTERNAL)
  @ConWriteWhenSuspended()
  @Post('alerts/:id/read')
  @HttpCode(200)
  readOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.markRead(id);
  }

  // ── Roles & staff (Director only) ──

  @ConRoles(...INTERNAL)
  @Get('roles')
  roles() {
    return this.construction.listRoles();
  }

  @ConRoles('CON_DIRECTOR')
  @Patch('roles/:code')
  roleLimit(@Param('code', new ParseEnumPipe(ConRoleCode)) code: ConRoleCode, @Body() dto: RoleLimitDto) {
    return this.construction.updateRoleLimit(code, dto);
  }

  @ConRoles('CON_DIRECTOR')
  @Get('staff')
  staff() {
    return this.construction.listStaff();
  }

  @ConRoles('CON_DIRECTOR')
  @Post('staff')
  addStaff(@Body() dto: AddConStaffDto) {
    return this.construction.addStaff(dto);
  }

  @ConRoles('CON_DIRECTOR')
  @Put('staff/:orgUserId/roles')
  setRoles(@Param('orgUserId', ParseUUIDPipe) orgUserId: string, @Body() dto: SetUserRolesDto) {
    return this.construction.setUserRoles(orgUserId, dto.roles);
  }

  // ── Compliance vault ──

  @ConFeature('compliance')
  @ConRoles(...VIEW_COMPLIANCE)
  @Get('compliance/health')
  health() {
    return this.compliance.health();
  }

  @ConFeature('compliance')
  @ConRoles(...VIEW_COMPLIANCE)
  @Get('compliance/registrations')
  registrations() {
    return this.compliance.listRegistrations();
  }

  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Put('compliance/registrations')
  saveRegistration(@Body() dto: RegistrationDto) {
    return this.compliance.saveRegistration(dto);
  }

  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Delete('compliance/registrations/:id')
  removeRegistration(@Param('id', ParseUUIDPipe) id: string) {
    return this.compliance.removeRegistration(id);
  }

  @ConFeature('compliance')
  @ConRoles(...VIEW_COMPLIANCE)
  @Get('compliance/docs')
  docs() {
    return this.compliance.listDocs();
  }

  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Post('compliance/docs')
  createDoc(@Body() dto: ComplianceDocDto) {
    return this.compliance.createDoc(dto);
  }

  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Put('compliance/docs/:id')
  updateDoc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ComplianceDocDto) {
    return this.compliance.updateDoc(id, dto);
  }

  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Delete('compliance/docs/:id')
  removeDoc(@Param('id', ParseUUIDPipe) id: string) {
    return this.compliance.removeDoc(id);
  }

  /** The file is the raw request body (PDF or photo), like product photos; its name comes in X-File-Name. */
  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Throttle(UPLOAD_THROTTLE)
  @Post('compliance/docs/:id/file')
  async uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('x-file-name') fileName: string | undefined,
    @Req() req: Request,
  ) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > MAX_DOC_BYTES) throw new PayloadTooLargeException('Documents must be 10MB or smaller');
      chunks.push(chunk);
    }
    const name = fileName ? decodeURIComponent(fileName) : undefined;
    return this.compliance.uploadFile(id, (contentType ?? '').split(';')[0].trim().toLowerCase(), Buffer.concat(chunks), name);
  }

  @ConFeature('compliance')
  @ConRoles(...VIEW_COMPLIANCE)
  @Get('compliance/docs/:id/file')
  async download(@Param('id', ParseUUIDPipe) id: string) {
    const file = await this.compliance.download(id);
    return new StreamableFile(file.stream, { type: file.contentType, disposition: `inline; filename="${file.fileName.replace(/[^\w.\- ]/g, '_')}"` });
  }

  @ConFeature('compliance')
  @ConRoles(...VIEW_COMPLIANCE)
  @Get('compliance/limits')
  limits() {
    return this.compliance.listLimits();
  }

  @ConFeature('compliance')
  @ConRoles('CON_COMPLIANCE')
  @Patch('compliance/limits/:id')
  updateLimit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryLimitDto) {
    return this.compliance.updateLimit(id, dto);
  }

  @ConRoles(...INTERNAL)
  @Get('compliance/cap-check')
  capCheck(@Query() q: CapCheckDto) {
    return this.compliance.capCheck(q.worksClass, q.value);
  }

  // ── Tax settings ──

  @ConRoles(...INTERNAL)
  @Get('settings/tax')
  tax() {
    return this.compliance.listTaxSettings();
  }

  @ConRoles('CON_ACCOUNTANT')
  @Post('settings/tax')
  addTax(@Body() dto: TaxSettingDto) {
    return this.compliance.addTaxSetting(dto);
  }

  // ── Plan & billing ──

  @Get('plan')
  plan() {
    return this.plans.mine();
  }

  @Get('plan/quote')
  quote(@Query() q: QuoteQueryDto) {
    return this.plans.quote(q);
  }

  @ConRoles('CON_ACCOUNTANT')
  @ConWriteWhenSuspended()
  @Post('plan/pay')
  pay(@Body() dto: PayPlanDto) {
    return this.plans.pay(dto);
  }

  @ConRoles('CON_ACCOUNTANT')
  @ConWriteWhenSuspended()
  @Post('plan/payments/:id/check')
  @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.checkPayment(id);
  }
}

/** Tuma's webhook for a construction plan payment, authenticated by the HMAC in the URL (see ConPlansService.handleTumaCallback). */
@Controller('public/construction-billing')
export class ConBillingCallbackController {
  constructor(private readonly plans: ConPlansService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':organizationId/:paymentId/tuma-callback/:token')
  @HttpCode(200)
  callback(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.plans.handleTumaCallback(organizationId, paymentId, token, body);
  }
}

/** The construction price list for the public pricing page on CONSTRUCTION_DOMAIN. */
@Controller('public/construction')
export class ConPublicController {
  constructor(private readonly setup: ConSetupService) {}

  @Public()
  @Get('plans')
  async plans() {
    return { plans: await this.setup.activePlans(), features: CON_FEATURES, trialDays: TRIAL_DAYS, trialPlan: TRIAL_PLAN };
  }
}
