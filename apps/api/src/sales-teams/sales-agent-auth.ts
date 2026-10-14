import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { SalesAgentRole, SalesAgentStatus, SalesTeamStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Marketing-team identity - a fifth token kind alongside staff, platform admin, buyer and rider. Signed
 * with the buyer secret but carrying scope 'sales-agent'; every strategy checks its own scope, so this
 * token can't pass as any other (and none of theirs can pass as this). Routes are @Public() (skipping the
 * staff guard) and apply SalesAgentAuthGuard explicitly - the same pattern as buyers and riders.
 *
 * Unlike those, the token is not trusted on its own: every request re-reads the account, so suspending a
 * person (or pausing their team) cuts them off at once instead of when the token expires.
 */
export interface SalesAgentJwtPayload {
  sub: string; // SalesAgent id
  scope: 'sales-agent';
}

export interface AuthenticatedAgent {
  agentId: string;
  teamId: string;
  role: SalesAgentRole;
  mustChangePassword: boolean;
}

@Injectable()
export class SalesAgentJwtStrategy extends PassportStrategy(Strategy, 'sales-agent-jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('BUYER_JWT_SECRET'),
    });
  }

  async validate(payload: SalesAgentJwtPayload): Promise<AuthenticatedAgent | false> {
    if (payload.scope !== 'sales-agent') return false;
    const agent = await this.prisma.salesAgent.findUnique({
      where: { id: payload.sub },
      select: { id: true, teamId: true, role: true, status: true, mustChangePassword: true, team: { select: { status: true } } },
    });
    if (!agent || agent.status !== SalesAgentStatus.ACTIVE || agent.team.status !== SalesTeamStatus.ACTIVE) return false;
    return { agentId: agent.id, teamId: agent.teamId, role: agent.role, mustChangePassword: agent.mustChangePassword };
  }
}

@Injectable()
export class SalesAgentAuthGuard extends AuthGuard('sales-agent-jwt') {}

/** The verified agent from SalesAgentAuthGuard. */
export const CurrentAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedAgent => {
  const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedAgent }>();
  return request.user;
});

/**
 * Everything except "who am I" and "change my password" waits until the person has replaced the temporary
 * password they were given - a leaked or shared temporary password then cannot be used to work on their account.
 * Use after SalesAgentAuthGuard.
 */
@Injectable()
export class PasswordChangedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const agent = context.switchToHttp().getRequest<{ user?: AuthenticatedAgent }>().user;
    if (agent?.mustChangePassword) throw new ForbiddenException('Please choose your own password first');
    return true;
  }
}
