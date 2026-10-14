import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SalesAgentStatus, SalesTeamStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { SalesAgentChangePasswordDto, SalesAgentLoginDto } from './dto/sales-team.dto';
import { toAgentView, toTeamView } from './sales-teams.service';
import type { SalesAgentJwtPayload } from './sales-agent-auth';

const SALT_ROUNDS = 10;
// A real hash of nothing in particular - compared against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

/** A marketing-team member or leader signing in, changing their password, and reading their own profile. */
@Injectable()
export class SalesAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: SalesAgentLoginDto) {
    const email = dto.email.trim().toLowerCase();
    const agent = await this.prisma.salesAgent.findUnique({ where: { email }, include: { team: true } });
    const passwordOk = await bcrypt.compare(dto.password, agent?.passwordHash ?? DUMMY_HASH);
    // One message for every failure, so the response can't be used to find out which emails have accounts.
    if (!agent || !passwordOk) throw new UnauthorizedException('Invalid email or password');
    if (agent.status !== SalesAgentStatus.ACTIVE) {
      throw new UnauthorizedException('This account is suspended. Please contact Zaroda.');
    }
    if (agent.team.status !== SalesTeamStatus.ACTIVE) {
      throw new UnauthorizedException("Your team is paused. Please contact Zaroda.");
    }
    await this.prisma.salesAgent.update({ where: { id: agent.id }, data: { lastLoginAt: new Date() } });
    const payload: SalesAgentJwtPayload = { sub: agent.id, scope: 'sales-agent' };
    return {
      accessToken: await this.jwt.signAsync(payload),
      agent: toAgentView(agent),
      team: toTeamView(agent.team),
    };
  }

  async me(agentId: string) {
    const agent = await this.prisma.salesAgent.findUnique({ where: { id: agentId }, include: { team: true } });
    if (!agent) throw new UnauthorizedException();
    return { agent: toAgentView(agent), team: toTeamView(agent.team) };
  }

  async changePassword(agentId: string, dto: SalesAgentChangePasswordDto) {
    const agent = await this.prisma.salesAgent.findUnique({ where: { id: agentId } });
    if (!agent || !(await bcrypt.compare(dto.currentPassword, agent.passwordHash))) {
      throw new BadRequestException('The current password is not right');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('Choose a new password that is different from the current one');
    }
    await this.prisma.salesAgent.update({
      where: { id: agentId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, SALT_ROUNDS), mustChangePassword: false },
    });
    return { message: 'Password changed' };
  }
}
