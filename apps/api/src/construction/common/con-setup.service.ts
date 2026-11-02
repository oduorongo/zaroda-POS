import { Injectable } from '@nestjs/common';
import { ConPlan, ConRoleCode, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/authenticated-user.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlanLike, parseFeatures, parseLimits, subscriptionStatus } from '../plans/con-plans.util';
import { CON_APPROVAL_LIMITS, CON_ROLES, CUSTOM_ROLE_GRANTS, NCA_CAPS, TAX_DEFAULTS, TAX_EFFECTIVE_FROM, TRIAL_DAYS, TRIAL_PLAN } from './con-defaults';
import type { ConContext } from './con-access';

type Tx = Prisma.TransactionClient;
const PLAN_CACHE_MS = 60_000;

/** The company jobs a custom role may act as (never Director: users and roles stay the Director's). */
export const parseGrants = (raw: Prisma.JsonValue): ConRoleCode[] => (Array.isArray(raw) ? raw.filter((r): r is ConRoleCode => typeof r === 'string' && CUSTOM_ROLE_GRANTS.includes(r as ConRoleCode)) : []);

export const toPlan = (p: ConPlan): PlanLike => ({
  code: p.code,
  name: p.name,
  monthlyPrice: Number(p.monthlyPrice),
  annualPrice: p.annualPrice === null ? null : Number(p.annualPrice),
  quoteOnly: p.quoteOnly,
  setupFee: p.setupFee === null ? null : Number(p.setupFee),
  setupFeeOptional: p.setupFeeOptional,
  limits: parseLimits(p.limits),
  features: parseFeatures(p.features),
  sortOrder: p.sortOrder,
});

/**
 * Gives a construction business its starting data the first time it is used (signup, a platform admin switching a business
 * to CONSTRUCTION, or the demo seed): a 14-day Contractor trial, the roles with approval limits, NCA caps, tax settings, and
 * the Director role for every owner. Idempotent - every insert skips rows that already exist.
 */
@Injectable()
export class ConSetupService {
  private readonly ready = new Set<string>();
  private plans: { at: number; rows: PlanLike[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensure(tx: Tx, organizationId: string, now: Date = new Date()) {
    if (this.ready.has(organizationId)) return;
    const sub = await tx.conSubscription.createMany({
      data: [{ organizationId, planCode: TRIAL_PLAN, status: 'TRIAL', currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * 86_400_000) }],
      skipDuplicates: true,
    });
    await tx.conRole.createMany({
      data: CON_ROLES.map((r) => ({ organizationId, ...r, approvalLimit: CON_APPROVAL_LIMITS[r.code] ?? null })),
      skipDuplicates: true,
    });
    await tx.conCategoryLimit.createMany({
      data: Object.entries(NCA_CAPS).flatMap(([worksClass, caps]) =>
        caps.map((maxValue, i) => ({ organizationId, worksClass: worksClass as keyof typeof NCA_CAPS, ncaCategory: i + 1, maxValue })),
      ),
      skipDuplicates: true,
    });
    const haveKeys = new Set((await tx.conTaxSetting.findMany({ select: { key: true }, distinct: ['key'] })).map((r) => r.key));
    const missing = TAX_DEFAULTS.filter((t) => !haveKeys.has(t.key));
    if (missing.length) {
      await tx.conTaxSetting.createMany({
        data: missing.map((t) => ({ organizationId, key: t.key, rate: t.rate, threshold: t.threshold ?? null, active: t.active ?? true, effectiveFrom: TAX_EFFECTIVE_FROM, notes: t.notes })),
        skipDuplicates: true,
      });
    }
    const owners = await tx.orgUser.findMany({ where: { organizationId, role: Role.OWNER, isActive: true }, select: { id: true } });
    await tx.conUserRole.createMany({ data: owners.map((o) => ({ organizationId, orgUserId: o.id, role: 'CON_DIRECTOR' as const })), skipDuplicates: true });
    if (sub.count > 0) {
      await tx.auditLog.create({
        data: { organizationId, action: 'construction.setup', entityType: 'ConSubscription', entityId: organizationId, after: { planCode: TRIAL_PLAN, status: 'TRIAL', trialDays: TRIAL_DAYS } },
      });
    }
    this.ready.add(organizationId);
  }

  async activePlans(): Promise<PlanLike[]> {
    if (this.plans && Date.now() - this.plans.at < PLAN_CACHE_MS) return this.plans.rows;
    const rows = (await this.prisma.conPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })).map(toPlan);
    this.plans = { at: Date.now(), rows };
    return rows;
  }

  clearPlanCache() {
    this.plans = null;
  }

  async context(tx: Tx, user: AuthenticatedUser): Promise<ConContext> {
    const [sub, direct, members, office, custom] = await Promise.all([
      tx.conSubscription.findUniqueOrThrow({ where: { organizationId: user.organizationId } }),
      tx.conUserRole.findMany({ where: { orgUserId: user.orgUserId }, select: { role: true } }),
      tx.conProjectMember.findMany({ where: { orgUserId: user.orgUserId }, select: { projectId: true, role: true } }),
      tx.conUserOffice.findUnique({ where: { orgUserId: user.orgUserId } }),
      tx.conUserCustomRole.findMany({ where: { orgUserId: user.orgUserId }, include: { customRole: { select: { grants: true, approvalLimit: true } } } }),
    ]);
    const plans = await this.activePlans();
    const row = plans.find((p) => p.code === sub.planCode) ?? toPlan((await tx.conPlan.findUniqueOrThrow({ where: { code: sub.planCode } })));
    const isOwner = user.role === Role.OWNER;
    // Enterprise custom roles act as the company jobs they grant; office staff see only their office's projects
    const customLimits = row.features.includes('custom_roles') ? custom.map((c) => ({ grants: parseGrants(c.customRole.grants), limit: c.customRole.approvalLimit === null ? null : Number(c.customRole.approvalLimit) })) : [];
    const companyRoles = [...new Set([...direct.map((r) => r.role), ...customLimits.flatMap((c) => c.grants)])];
    let projectRoles = members;
    let officeProjectIds: string[] | null = null;
    if (office && row.features.includes('multi_branch') && !isOwner && !companyRoles.includes('CON_DIRECTOR')) {
      officeProjectIds = (await tx.conProject.findMany({ where: { officeId: office.officeId }, select: { id: true } })).map((p) => p.id);
      projectRoles = [...members, ...officeProjectIds.flatMap((projectId) => companyRoles.map((role) => ({ projectId, role })))];
    }
    return {
      organizationId: user.organizationId,
      orgUserId: user.orgUserId,
      isOwner,
      companyRoles,
      projectRoles,
      plan: row,
      status: subscriptionStatus(sub),
      officeId: office && officeProjectIds ? office.officeId : null,
      officeProjectIds,
      customLimits,
    };
  }
}
