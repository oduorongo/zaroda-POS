import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConRoleCode } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { asOrg } from '../common/con-access';
import { ConSetupService } from '../common/con-setup.service';
import { isReadOnly, subscriptionStatus } from '../plans/con-plans.util';
import { PortalJwtPayload } from './portal-auth.service';

/** Who is using the portal, and the only projects they may see. */
export interface PortalCtx {
  id: string;
  organizationId: string;
  name: string;
  role: ConRoleCode;
  partyId: string | null;
  projectIds: string[];
}
export type PortalRequest = Request & { portal?: PortalCtx };

/**
 * Checks a portal token (scope con-portal, so no staff, shopper or tenant token passes), that the person is still active, and
 * that the builder's plan still includes the portal. Portal routes are @Public() (skipping the staff guard) and use this instead.
 */
@Injectable()
export class ConPortalGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly setup: ConSetupService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PortalRequest>();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    let payload: PortalJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PortalJwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.scope !== 'con-portal' || !payload.sub || !payload.org) throw new UnauthorizedException();
    const found = await asOrg(this.prisma, payload.org, async (tx) => {
      const user = await tx.conPortalUser.findUnique({ where: { id: payload.sub }, include: { access: { select: { projectId: true } } } });
      const sub = await tx.conSubscription.findUnique({ where: { organizationId: payload.org } });
      return { user, sub };
    });
    if (!found.user || !found.user.isActive || found.user.organizationId !== payload.org) throw new UnauthorizedException('Your portal access has been removed.');
    const plan = (await this.setup.activePlans()).find((p) => p.code === found.sub?.planCode);
    if (!plan?.features.includes('portal')) throw new ForbiddenException('This builder\'s portal is switched off at the moment.');
    if (!['GET', 'HEAD'].includes(req.method) && found.sub && isReadOnly(subscriptionStatus(found.sub))) throw new ForbiddenException('This builder\'s account is read-only at the moment, so nothing can be changed.');
    req.portal = { id: found.user.id, organizationId: payload.org, name: found.user.name, role: found.user.role, partyId: found.user.partyId, projectIds: found.user.access.map((a) => a.projectId) };
    return true;
  }
}
