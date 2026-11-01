import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConRoleCode } from '@prisma/client';
import { Public } from '../../auth/public.decorator';
import { ConFeature, ConProjectGuard, ConRequest, ConRoles, ConstructionGuard } from '../common/con-access';
import { PayoutSettingsDto, PayrollPayDto, PayrollRunDto } from '../dto/payroll-portal.dto';
import { PayrollService } from './payroll.service';

const ACC: ConRoleCode = 'CON_ACCOUNTANT';
const VIEW: ConRoleCode[] = [ACC, 'CON_CONTRACTS_MGR', 'CON_PROJECT_MGR'];

@Controller('construction')
@UseGuards(ConstructionGuard, ConProjectGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @ConFeature('payroll')
  @ConRoles(...VIEW)
  @Get('projects/:projectId/payroll-runs')
  list(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.payroll.list(projectId);
  }

  @ConFeature('payroll')
  @ConRoles(...VIEW)
  @Get('projects/:projectId/payroll-runs/:id')
  get(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.get(projectId, id);
  }

  @ConFeature('payroll')
  @ConRoles(ACC)
  @Post('projects/:projectId/payroll-runs')
  create(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: PayrollRunDto) {
    return this.payroll.create(req.con!, projectId, dto);
  }

  @ConFeature('payroll')
  @ConRoles(ACC)
  @Delete('projects/:projectId/payroll-runs/:id')
  remove(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.remove(projectId, id);
  }

  /** Director, or another accountant (never whoever prepared it). */
  @ConFeature('payroll')
  @ConRoles(ACC)
  @Post('projects/:projectId/payroll-runs/:id/approve')
  @HttpCode(200)
  approve(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.approve(req.con!, projectId, id);
  }

  @ConFeature('payroll')
  @ConRoles(ACC)
  @Post('projects/:projectId/payroll-runs/:id/pay')
  @HttpCode(200)
  pay(@Req() req: ConRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayrollPayDto) {
    return this.payroll.pay(req.con!, projectId, id, dto);
  }

  @ConFeature('payroll')
  @ConRoles(ACC)
  @Get('payroll/settings')
  settings(@Req() req: ConRequest) {
    return this.payroll.settings(req.con!.organizationId);
  }

  @ConFeature('payroll')
  @ConRoles(ACC)
  @Put('payroll/settings')
  saveSettings(@Req() req: ConRequest, @Body() dto: PayoutSettingsDto) {
    return this.payroll.saveSettings(req.con!, dto);
  }
}

/** Safaricom's B2C results for wages paid from a business's own account. */
@Controller('public/construction/payroll/mpesa-b2c')
export class PayrollCallbackController {
  constructor(private readonly payroll: PayrollService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post(':organizationId/:secret/result')
  @HttpCode(200)
  result(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('secret') secret: string, @Body() body: unknown) {
    return this.payroll.b2cResult(organizationId, secret, body);
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post(':organizationId/:secret/timeout')
  @HttpCode(200)
  timeout(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('secret') secret: string, @Body() body: unknown) {
    return this.payroll.b2cResult(organizationId, secret, body, true);
  }
}
