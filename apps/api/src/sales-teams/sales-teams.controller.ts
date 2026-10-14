import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
import { AuthenticatedAgent, CurrentAgent, PasswordChangedGuard, SalesAgentAuthGuard } from './sales-agent-auth';
import { SalesAgentService } from './sales-agent.service';
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
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.resetAgentPassword(req.user!.platformAdminId, id);
  }
}

/** A leader or member's own sign-in and profile. */
@Controller('sales-agent')
export class SalesAgentController {
  constructor(private readonly agents: SalesAgentService) {}

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
