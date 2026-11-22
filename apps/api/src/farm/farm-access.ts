import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FarmRoleCode, FarmSubscriptionStatus, Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../common/prisma/prisma.service';
import { FARM_FEATURES, FarmFeatureKey, FarmPlanLike, cheapestWith, isReadOnly } from './farm-plans.util';
import { FarmSetupService } from './farm-setup.service';

export type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

/** A transaction with the tenant set - for guards and jobs, which run outside the tenant interceptor. */
export function asOrg<T>(prisma: PrismaService, organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

export interface FarmContext {
  organizationId: string;
  orgUserId: string;
  isOwner: boolean;
  roles: FarmRoleCode[];
  /** The units a person is limited to; null = the whole farm. */
  unitIds: string[] | null;
  plan: FarmPlanLike;
  status: FarmSubscriptionStatus;
}
export type FarmRequest = Request & { user?: AuthenticatedUser; farm?: FarmContext };

export const FARM_ROLES_KEY = 'farmRoles';
export const FARM_FEATURE_KEY = 'farmFeature';
export const FARM_WRITE_WHEN_SUSPENDED_KEY = 'farmWriteWhenSuspended';

/** Who may call a route: any of these farm roles. The owner and FARM_OWNER always may. */
export const FarmRoles = (...roles: FarmRoleCode[]) => SetMetadata(FARM_ROLES_KEY, roles);
/** The route needs this plan feature; otherwise 402 with an upgrade message. */
export const FarmFeature = (feature: FarmFeatureKey) => SetMetadata(FARM_FEATURE_KEY, feature);
/** Writes still allowed while the plan is suspended (paying for it). */
export const FarmWriteWhenSuspended = () => SetMetadata(FARM_WRITE_WHEN_SUSPENDED_KEY, true);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isFarmOwner = (farm: FarmContext) => farm.isOwner || farm.roles.includes('FARM_OWNER');

export function hasFarmRole(farm: FarmContext, roles: FarmRoleCode[]): boolean {
  return isFarmOwner(farm) || roles.some((r) => farm.roles.includes(r));
}

export function upgradeError(message: string, extra: Record<string, unknown> = {}) {
  return new HttpException({ statusCode: HttpStatus.PAYMENT_REQUIRED, message, upgrade: true, ...extra }, HttpStatus.PAYMENT_REQUIRED);
}

/**
 * Every Shamba route: only FARM businesses, then @FarmRoles, @FarmFeature, and read-only once the plan is SUSPENDED
 * (reads still work; nothing is deleted). Loads the caller's farm context onto req.farm.
 */
@Injectable()
export class FarmGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly setup: FarmSetupService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FarmRequest>();
    const user = req.user;
    if (!user?.organizationId) throw new ForbiddenException();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);

    const farm = await asOrg(this.prisma, user.organizationId, async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: user.organizationId }, select: { industryType: true } });
      if (org?.industryType !== 'FARM') throw new ForbiddenException('This is only for farms (Zaroda Shamba).');
      await this.setup.ensure(tx, user.organizationId);
      return this.setup.context(tx, user);
    });
    req.farm = farm;

    if (!READ_METHODS.has(req.method) && isReadOnly(farm.status) && !meta<boolean>(FARM_WRITE_WHEN_SUSPENDED_KEY)) {
      throw upgradeError('Your Shamba plan has lapsed, so the farm is read-only. You can still see everything. Pay for the plan to continue - nothing has been deleted.', { readOnly: true });
    }

    const feature = meta<FarmFeatureKey>(FARM_FEATURE_KEY);
    if (feature && !farm.plan.features.includes(feature)) {
      const target = cheapestWith(await this.setup.activePlans(), (p) => p.features.includes(feature));
      throw upgradeError(`${FARM_FEATURES[feature]} is not on your ${farm.plan.name} plan.${target ? ` Upgrade to ${target.name} to use it.` : ''}`, {
        feature,
        requiredPlan: target?.code ?? null,
      });
    }

    const roles = meta<FarmRoleCode[]>(FARM_ROLES_KEY);
    if (roles?.length && !hasFarmRole(farm, roles)) throw new ForbiddenException('Your farm role does not allow this.');
    return true;
  }
}

export const Farm = () => applyDecorators(UseGuards(FarmGuard));

/** Links for farms always use SHAMBA_DOMAIN, always https (.app domains are HTTPS-only). null when unset. */
export function shambaUrl(path: string, domain: string | undefined = process.env.SHAMBA_DOMAIN): string | null {
  const host = domain?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return host ? `https://${host}${path.startsWith('/') ? path : `/${path}`}` : null;
}
