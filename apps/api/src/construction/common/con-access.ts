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
import { ConRoleCode, ConSubscriptionStatus, Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/authenticated-user.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CON_FEATURES, ConFeatureKey, PlanLike, cheapestWith, isReadOnly } from '../plans/con-plans.util';
import { ConSetupService } from './con-setup.service';

export type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

/** A transaction with the tenant set - for guards and jobs, which run outside TenantContextInterceptor. */
export function asOrg<T>(prisma: PrismaService, organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

export interface ConContext {
  organizationId: string;
  orgUserId: string;
  isOwner: boolean;
  companyRoles: ConRoleCode[];
  projectRoles: { projectId: string; role: ConRoleCode }[];
  plan: PlanLike;
  status: ConSubscriptionStatus;
}
export type ConRequest = Request & { user?: AuthenticatedUser; con?: ConContext };

export const CON_ROLES_KEY = 'conRoles';
export const CON_FEATURE_KEY = 'conFeature';
export const CON_WRITE_WHEN_SUSPENDED_KEY = 'conWriteWhenSuspended';

/** Who may call a route: any of these construction roles (company-level, or project-level on the project in the request). Director/owner always may. */
export const ConRoles = (...roles: ConRoleCode[]) => SetMetadata(CON_ROLES_KEY, roles);
/** The route needs this plan feature; otherwise 402 with an upgrade message. */
export const ConFeature = (feature: ConFeatureKey) => SetMetadata(CON_FEATURE_KEY, feature);
/** Writes still allowed while the plan is suspended (paying for it). */
export const ConWriteWhenSuspended = () => SetMetadata(CON_WRITE_WHEN_SUSPENDED_KEY, true);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALL_PROJECTS: ConRoleCode[] = ['CON_DIRECTOR', 'CON_CONTRACTS_MGR'];

export function hasRole(con: ConContext, roles: ConRoleCode[], projectId?: string): boolean {
  if (con.isOwner || con.companyRoles.includes('CON_DIRECTOR')) return true;
  if (roles.some((r) => con.companyRoles.includes(r))) return true;
  return con.projectRoles.some((p) => roles.includes(p.role) && (!projectId || p.projectId === projectId));
}

export const canSeeAllProjects = (con: ConContext) => con.isOwner || ALL_PROJECTS.some((r) => con.companyRoles.includes(r));

export function upgradeError(message: string, extra: Record<string, unknown> = {}) {
  return new HttpException({ statusCode: HttpStatus.PAYMENT_REQUIRED, message, upgrade: true, ...extra }, HttpStatus.PAYMENT_REQUIRED);
}

export const projectIdOf = (req: ConRequest): string | undefined => {
  const v = req.params?.projectId ?? (req.query?.projectId as string | undefined) ?? (req.body as { projectId?: unknown } | undefined)?.projectId;
  return typeof v === 'string' ? v : undefined;
};

/**
 * Every construction route: only CONSTRUCTION businesses, then @ConRoles, @ConFeature, and read-only once the plan is SUSPENDED
 * (reads and exports still work; nothing is deleted). Loads the caller's construction context onto req.con.
 */
@Injectable()
export class ConstructionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly setup: ConSetupService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ConRequest>();
    const user = req.user;
    if (!user?.organizationId) throw new ForbiddenException();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);

    const con = await asOrg(this.prisma, user.organizationId, async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: user.organizationId }, select: { industryType: true } });
      if (org?.industryType !== 'CONSTRUCTION') throw new ForbiddenException('This is only for construction businesses.');
      await this.setup.ensure(tx, user.organizationId);
      return this.setup.context(tx, user);
    });
    req.con = con;

    if (!READ_METHODS.has(req.method) && isReadOnly(con.status) && !meta<boolean>(CON_WRITE_WHEN_SUSPENDED_KEY)) {
      throw upgradeError('Your construction plan has lapsed, so the account is read-only. You can still see and export everything. Pay for the plan to continue - nothing has been deleted.', { readOnly: true });
    }

    const feature = meta<ConFeatureKey>(CON_FEATURE_KEY);
    if (feature && !con.plan.features.includes(feature)) {
      const plans = await this.setup.activePlans();
      const target = cheapestWith(plans, feature);
      throw upgradeError(`${CON_FEATURES[feature]} is not on your ${con.plan.name} plan.${target ? ` Upgrade to ${target.name} to use it.` : ''}`, {
        feature,
        requiredPlan: target?.code ?? null,
      });
    }

    const roles = meta<ConRoleCode[]>(CON_ROLES_KEY);
    if (roles?.length && !hasRole(con, roles, projectIdOf(req))) {
      throw new ForbiddenException('Your construction role does not allow this.');
    }
    return true;
  }
}

/** Project screens: the caller must be a member of the project in the route (Directors and Contracts Managers see every project). */
@Injectable()
export class ConProjectGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ConRequest>();
    const con = req.con;
    const projectId = projectIdOf(req);
    if (!con) throw new ForbiddenException();
    if (!projectId || canSeeAllProjects(con)) return true;
    if (con.projectRoles.some((p) => p.projectId === projectId)) return true;
    throw new ForbiddenException('You are not on this project.');
  }
}

export const Construction = () => applyDecorators(UseGuards(ConstructionGuard));
