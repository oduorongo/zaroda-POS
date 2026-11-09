import { Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SalesAgentRole } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { PlatformAdminAuthGuard } from '../../platform-admin/platform-admin-auth.guard';
import { AuthenticatedAgent, CurrentAgent, PasswordChangedGuard, SalesAgentAuthGuard } from '../sales-agent-auth';
import { TrainingTypePipe } from './training-type.pipe';
import { TrainingAccountsService } from './training-accounts.service';

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

/** Platform owner: a team's training businesses (sample data, shared owner logins). */
@Controller('platform-admin/sales-teams/:id/training-accounts')
export class TrainingAccountsAdminController {
  constructor(private readonly training: TrainingAccountsService) {}

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.training.list(id);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  create(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.training.ensureForTeam(id, req.user!.platformAdminId);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post(':type/reset-password')
  @HttpCode(200)
  reset(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Param('type', TrainingTypePipe) type: string) {
    return this.training.resetPassword(id, type, { platformAdminId: req.user!.platformAdminId });
  }
}

/** Team side: everyone in the team sees the training logins; only the leader resets a password. */
@Controller('sales-agent/training-accounts')
export class TrainingAccountsAgentController {
  constructor(private readonly training: TrainingAccountsService) {}

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Get()
  list(@CurrentAgent() agent: AuthenticatedAgent) {
    return this.training.list(agent.teamId);
  }

  @Public()
  @UseGuards(SalesAgentAuthGuard, PasswordChangedGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':type/reset-password')
  @HttpCode(200)
  reset(@CurrentAgent() agent: AuthenticatedAgent, @Param('type', TrainingTypePipe) type: string) {
    if (agent.role !== SalesAgentRole.LEADER) throw new ForbiddenException('Only the team leader can reset training passwords');
    return this.training.resetPassword(agent.teamId, type, { agentId: agent.agentId });
  }
}
