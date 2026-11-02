import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConContext, asOrg } from '../common/con-access';
import { ConSetupService } from '../common/con-setup.service';
import { subscriptionStatus } from '../plans/con-plans.util';
import { hashApiKey } from './enterprise.service';

export interface ApiKeyCtx { keyId: string; organizationId: string; scopes: string[]; con: ConContext }
export type ApiKeyRequest = Request & { apiKey?: ApiKeyCtx };

const KEY = /^zcon_([0-9a-f]{12})_[A-Za-z0-9_-]{32}$/;

/**
 * Enterprise API: "Authorization: Bearer zcon_..." (or X-Api-Key). The key is found by its public prefix (the only cross-business
 * read, see rls.sql api_key_lookup), checked against its hash, and must not be revoked; the business must still be on a plan with
 * API access. The request then reads as that business's Director would, read-only.
 */
@Injectable()
export class ConApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: ConSetupService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();
    const header = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const raw = Array.isArray(header) ? header[0] : header;
    const m = raw ? KEY.exec(raw.trim()) : null;
    if (!m) throw new UnauthorizedException('Send your API key as "Authorization: Bearer zcon_..."');
    const key = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_api_key_prefix', ${m[1]}, true)`;
      return tx.conApiKey.findUnique({ where: { prefix: m[1] } });
    });
    const ok = key && !key.revokedAt && timingSafeEqual(Buffer.from(key.keyHash), Buffer.from(hashApiKey(raw!.trim())));
    if (!key || !ok) throw new UnauthorizedException('This API key is not valid or was revoked');

    const con = await asOrg(this.prisma, key.organizationId, async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: key.organizationId }, select: { industryType: true, isActive: true } });
      if (org?.industryType !== 'CONSTRUCTION' || !org.isActive) throw new ForbiddenException('This business is not active');
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId: key.organizationId } });
      const plan = (await this.setup.activePlans()).find((p) => p.code === sub.planCode);
      if (!plan?.features.includes('api')) throw new ForbiddenException('API access is on the Enterprise plan only');
      await tx.conApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), requests: { increment: 1 } } });
      const c: ConContext = { organizationId: key.organizationId, orgUserId: `api:${key.id}`, isOwner: true, companyRoles: ['CON_DIRECTOR'], projectRoles: [], plan, status: subscriptionStatus(sub), officeProjectIds: null };
      return c;
    });
    req.apiKey = { keyId: key.id, organizationId: key.organizationId, scopes: Array.isArray(key.scopes) ? (key.scopes as string[]) : [], con };
    return true;
  }
}
