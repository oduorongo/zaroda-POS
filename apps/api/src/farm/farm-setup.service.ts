import { Injectable } from '@nestjs/common';
import { FarmRoleCode, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../common/prisma/prisma.service';
import { FALLBACK_PLAN, FarmPlanLike, TRIAL_DAYS, TRIAL_PLAN, subscriptionStatus, toPlan } from './farm-plans.util';
import type { FarmContext } from './farm-access';

type Tx = Prisma.TransactionClient;
const PLAN_CACHE_MS = 60_000;

/**
 * Gives a farm its starting data the first time it is used (signup, a platform admin switching a business to FARM, or
 * the demo seed): settings named after the business, a 14-day Farmer trial, and FARM_OWNER for every owner. Idempotent.
 */
@Injectable()
export class FarmSetupService {
  private readonly ready = new Set<string>();
  private plans: { at: number; rows: FarmPlanLike[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensure(tx: Tx, organizationId: string, now: Date = new Date()) {
    if (this.ready.has(organizationId)) return;
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    await tx.farmSettings.createMany({ data: [{ organizationId, farmName: org.name }], skipDuplicates: true });
    const sub = await tx.farmSubscription.createMany({
      data: [{ organizationId, planCode: TRIAL_PLAN, status: 'TRIAL', currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * 86_400_000) }],
      skipDuplicates: true,
    });
    const owners = await tx.orgUser.findMany({ where: { organizationId, role: Role.OWNER, isActive: true }, select: { id: true } });
    await tx.farmUserRole.createMany({ data: owners.map((o) => ({ organizationId, orgUserId: o.id, role: FarmRoleCode.FARM_OWNER })), skipDuplicates: true });
    if (sub.count > 0) {
      await tx.auditLog.create({
        data: { organizationId, action: 'farm.setup', entityType: 'FarmSubscription', entityId: organizationId, after: { planCode: TRIAL_PLAN, status: 'TRIAL', trialDays: TRIAL_DAYS } },
      });
    }
    this.ready.add(organizationId);
  }

  async activePlans(): Promise<FarmPlanLike[]> {
    if (this.plans && Date.now() - this.plans.at < PLAN_CACHE_MS) return this.plans.rows;
    const rows = (await this.prisma.farmPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })).map(toPlan);
    this.plans = { at: Date.now(), rows };
    return rows;
  }

  clearPlanCache() {
    this.plans = null;
  }

  async context(tx: Tx, user: AuthenticatedUser): Promise<FarmContext> {
    const [sub, roles] = await Promise.all([
      tx.farmSubscription.findUniqueOrThrow({ where: { organizationId: user.organizationId } }),
      tx.farmUserRole.findMany({ where: { orgUserId: user.orgUserId }, select: { role: true, unitIds: true } }),
    ]);
    const plans = await this.activePlans();
    const plan =
      plans.find((p) => p.code === sub.planCode) ??
      toPlan(await tx.farmPlan.findUniqueOrThrow({ where: { code: plans.some((p) => p.code === sub.planCode) ? sub.planCode : FALLBACK_PLAN } }));
    return {
      organizationId: user.organizationId,
      orgUserId: user.orgUserId,
      isOwner: user.role === Role.OWNER,
      roles: roles.map((r) => r.role),
      unitIds: roles.some((r) => r.unitIds.length === 0) ? null : [...new Set(roles.flatMap((r) => r.unitIds))],
      plan,
      status: subscriptionStatus(sub),
    };
  }
}
