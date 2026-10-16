import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SalesAgentRole } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PlatformAdminAuthGuard } from '../platform-admin/platform-admin-auth.guard';
import {
  CreateSalesAgentDto,
  CreateSalesTeamDto,
  SalesAgentChangePasswordDto,
  SalesAgentLoginDto,
  SetSalesAgentStatusDto,
  UpdateSalesTeamDto,
} from './dto/sales-team.dto';
import { CreateShopRiderDto } from '../riders/dto/rider.dto';
import { AddMemberDto, OnboardTenantByAgentDto, SetMemberStatusDto } from './dto/sales-portal.dto';
import {
  EarningsMonthQueryDto,
  ManualPayoutDto,
  PayoutsQueryDto,
  RecordSalesAdjustmentDto,
  ResolvePayoutDto,
  SendPayoutDto,
  UpdatePayoutDetailsDto,
  UpdatePayoutSettingsDto,
} from './dto/sales-earnings.dto';
import { AssignShopDto } from './dto/sales-shop.dto';
import { MpesaB2cClient, parseB2cResult } from './mpesa-b2c.client';
import { SalesPayoutsService } from './sales-payouts.service';
import { AuthenticatedAgent, CurrentAgent, PasswordChangedGuard, SalesAgentAuthGuard } from './sales-agent-auth';
import { SalesAgentService } from './sales-agent.service';
import { SalesEarningsService } from './sales-earnings.service';
import { SalesPortalService } from './sales-portal.service';
import { SalesTeamsService } from './sales-teams.service';

const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** The platform owner's side: every team, its leader and members, and their terms. */
@Controller('platform-admin/sales-teams')
export class SalesTeamsAdminController {
  constructor(private readonly teams: SalesTeamsService) {}

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get()
  list() {
    return this.teams.listTeams();
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post()
  create(@Req() req: PlatformAdminRequest, @Body() dto: CreateSalesTeamDto) {
    return this.teams.createTeam(req.user!.platformAdminId, dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.getTeam(id);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch(':id')
  update(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalesTeamDto) {
    return this.teams.updateTeam(req.user!.platformAdminId, id, dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post(':id/leader')
  addLeader(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSalesAgentDto) {
    return this.teams.addAgent(req.user!.platformAdminId, id, SalesAgentRole.LEADER, dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post(':id/members')
  addMember(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSalesAgentDto) {
    return this.teams.addAgent(req.user!.platformAdminId, id, SalesAgentRole.MEMBER, dto);
  }

  /** Who signed a shop, and the people it could be given to. */
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('shops/:organizationId')
  shopAssignment(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.teams.shopAssignment(organizationId);
  }

  /** Give a shop to a team and member - the only way a shop's team or signer can change after sign-up. */
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('shops/:organizationId')
  assignShop(@Req() req: PlatformAdminRequest, @Param('organizationId', ParseUUIDPipe) organizationId: string, @Body() dto: AssignShopDto) {
    return this.teams.assignShop(req.user!.platformAdminId, organizationId, dto);
  }
}

/** The platform owner acting on one person (any team). */
@Controller('platform-admin/sales-agents')
export class SalesAgentsAdminController {
  constructor(private readonly teams: SalesTeamsService) {}

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch(':id/status')
  setStatus(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSalesAgentStatusDto) {
    return this.teams.setAgentStatus(req.user!.platformAdminId, id, dto.status);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch(':id/payout')
  setPayoutDetails(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayoutDetailsDto) {
    return this.teams.setPayoutDetails(req.user!.platformAdminId, id, dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.resetAgentPassword(req.user!.platformAdminId, id);
  }
}

/** A leader or member's own sign-in and profile. */
@Controller('sales-agent')
export class SalesAgentController {
  constructor(
    private readonly agents: SalesAgentService,
    private readonly teams: SalesTeamsService,
  ) {}

  /** Where I am paid (an M-Pesa number). */
  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Patch('me/payout')
  setMyPayoutDetails(@CurrentAgent() agent: AuthenticatedAgent, @Body() dto: UpdatePayoutDetailsDto) {
    return this.teams.setPayoutDetails(null, agent.agentId, dto);
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: SalesAgentLoginDto) {
    return this.agents.login(dto);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard)
  @Get('me')
  me(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.agents.me(agent.agentId);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard)
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/change-password')
  @HttpCode(200)
  changePassword(@CurrentAgent() agent: AuthenticatedAgent, @Body() dto: SalesAgentChangePasswordDto) {
    return this.agents.changePassword(agent.agentId, dto);
  }
}

/**
 * A leader's or member's working routes. SalesAgentAuthGuard proves who they are; PasswordChangedGuard holds
 * everything here back until they have replaced their temporary password. What each person may see is decided in
 * SalesPortalService (a member their own work, a leader their team's; members' management is leader-only).
 */
@Controller('sales-agent')
export class SalesPortalController {
  constructor(private readonly portal: SalesPortalService) {}

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get('overview')
  overview(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.portal.overview(agent);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get('tenants')
  tenants(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.portal.listTenants(agent);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('tenants')
  onboardTenant(@CurrentAgent() agent: AuthenticatedAgent, @Body() dto: OnboardTenantByAgentDto) {
    return this.portal.onboardTenant(agent, dto);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get('riders')
  riders(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.portal.listRiders(agent);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('riders')
  createRider(@CurrentAgent() agent: AuthenticatedAgent, @Body() dto: CreateShopRiderDto) {
    return this.portal.createRider(agent, dto);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get('members')
  members(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.portal.listMembers(agent);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Post('members')
  addMember(@CurrentAgent() agent: AuthenticatedAgent, @Body() dto: AddMemberDto) {
    return this.portal.addMember(agent, dto);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Patch('members/:id/status')
  setMemberStatus(@CurrentAgent() agent: AuthenticatedAgent, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetMemberStatusDto) {
    return this.portal.setMemberStatus(agent, id, dto.status);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Post('members/:id/reset-password')
  @HttpCode(200)
  resetMemberPassword(@CurrentAgent() agent: AuthenticatedAgent, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.resetMemberPassword(agent, id);
  }
}

/** A person's own earnings statement: this month, what is still owed to them, what they have been paid. A leader also sees the team. */
@Controller('sales-agent/earnings')
export class SalesEarningsAgentController {
  constructor(private readonly earnings: SalesEarningsService) {}

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get()
  statement(@CurrentAgent() agent: AuthenticatedAgent, @Query() query: EarningsMonthQueryDto) {
    return this.earnings.statement(agent, query.month);
  }
}

/** The platform owner's side of the money: what every team has earned and is owed, payout settings, and paying people. */
@Controller('platform-admin/sales-earnings')
export class SalesEarningsAdminController {
  constructor(
    private readonly earnings: SalesEarningsService,
    private readonly payouts: SalesPayoutsService,
  ) {}

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get()
  overview(@Query() query: EarningsMonthQueryDto) {
    return this.earnings.overview(query.month);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('settings')
  settings() {
    return this.payouts.settingsView();
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('settings')
  updateSettings(@Req() req: PlatformAdminRequest, @Body() dto: UpdatePayoutSettingsDto) {
    return this.payouts.updateSettings(req.user!.platformAdminId, dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('payouts')
  list(@Query() query: PayoutsQueryDto) {
    return this.payouts.list(query.agentId);
  }

  /** Record a payment made by hand, with its reference. */
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('payouts')
  recordManual(@Req() req: PlatformAdminRequest, @Body() dto: ManualPayoutDto) {
    return this.payouts.recordManual(req.user!.platformAdminId, dto);
  }

  /** Send one person's payable balance now through their gateway (M-Pesa B2C or TUMA). */
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('payouts/send')
  send(@Req() req: PlatformAdminRequest, @Body() dto: SendPayoutDto) {
    return this.payouts.sendNow(req.user!.platformAdminId, dto.agentId);
  }

  /** A payout stuck queued: say whether it was in fact paid or failed. */
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('payouts/:id/resolve')
  @HttpCode(200)
  resolve(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolvePayoutDto) {
    return this.payouts.resolve(req.user!.platformAdminId, id, dto);
  }

  /** A refund after earnings accrued: reverses the matching part of what the member and leader earned. */
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('adjustments')
  adjust(@Req() req: PlatformAdminRequest, @Body() dto: RecordSalesAdjustmentDto) {
    return this.earnings.recordAdjustment(req.user!.platformAdminId, dto);
  }
}

/**
 * Safaricom's B2C result and timeout notifications. Public (Safaricom has no login) but the URL carries a secret only
 * Safaricom was given, and the result is matched to a payout by its own request id, so an outsider can settle nothing.
 */
@Controller('sales-payouts/mpesa-b2c')
export class SalesPayoutCallbackController {
  constructor(
    private readonly payouts: SalesPayoutsService,
    private readonly b2c: MpesaB2cClient,
  ) {}

  private check(secret: string) {
    const expected = this.b2c.callbackSecret();
    const a = Buffer.from(secret);
    const b = Buffer.from(expected ?? '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException();
  }

  @Public()
  @Post('result/:secret')
  @HttpCode(200)
  async result(@Param('secret') secret: string, @Body() body: unknown) {
    this.check(secret);
    await this.payouts.settleB2c(parseB2cResult(body));
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  // A timeout does not say whether the money moved, so nothing is settled: the payout stays queued for an admin to resolve.
  @Public()
  @Post('timeout/:secret')
  @HttpCode(200)
  timeout(@Param('secret') secret: string) {
    this.check(secret);
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}
