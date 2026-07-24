import { randomUUID } from 'crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/create-plan.dto';
import { OnboardTenantDto } from './dto/onboard-tenant.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { effectiveStatus } from './subscriptions.util';

const SALT_ROUNDS = 10;

/**
 * Every method here queries across tenants - the one identity in this
 * system allowed to. Deliberately does NOT use TenantScopedPrismaService
 * (there's no single tenant to scope to) or a BYPASSRLS Postgres role
 * (a heavier piece of infrastructure this pilot doesn't need yet). Instead:
 *
 * - Listing organizations themselves relies on organizations' own
 *   pre-auth RLS exception (prisma/rls.sql: "OR NULLIF(current_setting(...),
 *   '') IS NULL" - the same exception login() already depends on to find
 *   which org an email belongs to before a tenant exists). A plain query
 *   with no set_config call ever made in the transaction sees every row.
 * - Anything scoped to one specific tenant's own child tables (branches,
 *   org users) is fetched by briefly setting app.current_tenant to that
 *   org's id for one transaction, then querying normally within it - the
 *   exact same mechanism TenantScopedPrismaService.run() uses, just
 *   looped across N tenants here instead of fixed to one.
 * - plans/subscriptions/subscription_payments carry no RLS at all (see
 *   their schema.prisma comment) - queried directly, no set_config needed.
 *
 * Documented pilot-scale limit: the loop is N *sequential* round trips
 * for an org-list-with-counts view (deliberately not fired concurrently
 * via Promise.all - this codebase's own load-testing history, see the
 * README, found that firing many concurrent interactive transactions
 * against Neon exhausts the connection pool and produces exactly the
 * P2028 "unable to start a transaction in the given time" this method
 * would otherwise be an easy way to trigger on every page load), not one
 * aggregate query. Fine at this pilot's scale (DESIGN.md's stated
 * target); revisit with a real BYPASSRLS-based read replica or admin
 * role if the platform ever hosts enough tenants for this to matter.
 *
 * Every raw $transaction below passes the same {timeout: 15_000, maxWait:
 * 15_000} override TenantScopedPrismaService.run() and AuthService's own
 * raw transactions use - Prisma's defaults (5s/2s) are already known too
 * short for this project's observed Neon latency (see README's load-test
 * history); omitting the override here isn't a smaller version of that
 * problem, it's the identical bug freshly reintroduced.
 */
const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const subscriptions = await this.prisma.subscription.findMany({
      include: { plan: true },
    });
    const subByOrg = new Map(subscriptions.map((s) => [s.organizationId, s]));

    const results = [];
    for (const org of organizations) {
      const counts = await this.countsForOrg(org.id);
      const sub = subByOrg.get(org.id);
      results.push({
        ...org,
        ...counts,
        subscription: sub
          ? {
              planTier: sub.plan.tier,
              planName: sub.plan.name,
              currentPeriodEnd: sub.currentPeriodEnd,
              status: effectiveStatus(sub),
            }
          : null,
      });
    }
    return results;
  }

  async getOrganization(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    const counts = await this.countsForOrg(id);
    const branches = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${id}, true)`;
      return tx.branch.findMany({ orderBy: { name: 'asc' } });
    }, TX_OPTIONS);
    const orgUsers = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${id}, true)`;
      return tx.orgUser.findMany({
        select: {
          id: true,
          role: true,
          isActive: true,
          user: { select: { fullName: true, email: true } },
        },
        orderBy: { user: { fullName: 'asc' } },
      });
    }, TX_OPTIONS);
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: id },
      include: { plan: true, payments: { orderBy: { paidAt: 'desc' }, take: 20 } },
    });

    return {
      ...org,
      ...counts,
      branches,
      orgUsers,
      subscription: subscription
        ? { ...subscription, status: effectiveStatus(subscription) }
        : null,
    };
  }

  private async countsForOrg(organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      const branchCount = await tx.branch.count();
      const orgUserCount = await tx.orgUser.count();
      const saleCount = await tx.sale.count();
      const terminalCount = await tx.terminal.count({
        where: { branch: { organizationId } },
      });
      return { branchCount, orgUserCount, saleCount, terminalCount };
    }, TX_OPTIONS);
  }

  // ── Plans ────────────────────────────────────────────────────────────

  listPlans() {
    return this.prisma.plan.findMany({ orderBy: { priceKes: 'asc' } });
  }

  createPlan(dto: CreatePlanDto) {
    return this.prisma.plan.create({ data: dto });
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  // ── Onboarding ───────────────────────────────────────────────────────

  /**
   * Admin-driven onboarding - unlike the public /auth/register (which
   * always starts a BASIC trial), a platform admin picks the plan
   * directly and the tenant starts ACTIVE (isTrial: false), since an
   * admin walking someone through onboarding implies a plan has already
   * been agreed, not a self-serve trial.
   */
  async onboardTenant(dto: OnboardTenantDto) {
    const plan = await this.prisma.plan.findUnique({ where: { tier: dto.planTier } });
    if (!plan) throw new NotFoundException(`No plan with tier ${dto.planTier}`);

    const organizationId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;

        await tx.organization.create({
          data: {
            id: organizationId,
            name: dto.organizationName,
            industryType: dto.industryType,
            kraPin: dto.kraPin,
          },
        });

        const user = await tx.user.create({
          data: {
            email: dto.ownerEmail,
            fullName: dto.ownerFullName,
            passwordHash: await bcrypt.hash(dto.ownerPassword, SALT_ROUNDS),
          },
        });

        await tx.orgUser.create({
          data: { organizationId, userId: user.id, role: Role.OWNER },
        });

        const branch = await tx.branch.create({
          data: { organizationId, name: dto.branchName },
        });

        const terminalCount = dto.terminalCount ?? 1;
        for (let i = 1; i <= terminalCount; i++) {
          await tx.terminal.create({
            data: { branchId: branch.id, deviceLabel: `Register ${i}` },
          });
        }

        const subscription = await tx.subscription.create({
          data: {
            organizationId,
            planId: plan.id,
            currentPeriodEnd: new Date(Date.now() + plan.billingPeriodDays * 24 * 60 * 60 * 1000),
            isTrial: false,
          },
        });

        return { organizationId, branchId: branch.id, subscriptionId: subscription.id };
      }, TX_OPTIONS);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An account already exists for this email');
      }
      throw e;
    }
  }

  // ── Billing ──────────────────────────────────────────────────────────

  /**
   * Recording a payment extends currentPeriodEnd by the plan's billing
   * period from whichever is later - "now" or the current period end -
   * so paying early stacks onto the existing paid-through date rather
   * than shortening it, and paying late (after the grace window) starts
   * the new period from today rather than backdating.
   */
  async recordPayment(
    organizationId: string,
    dto: RecordPaymentDto,
    platformAdminId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('This tenant has no subscription');

    const base = subscription.currentPeriodEnd > new Date() ? subscription.currentPeriodEnd : new Date();
    const newPeriodEnd = new Date(base.getTime() + subscription.plan.billingPeriodDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference,
          periodEnd: newPeriodEnd,
          recordedByPlatformAdminId: platformAdminId,
        },
      });
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: { currentPeriodEnd: newPeriodEnd, isTrial: false },
        include: { plan: true },
      });
      return { payment, subscription: { ...updated, status: effectiveStatus(updated) } };
    }, TX_OPTIONS);
  }

  async setSuspension(organizationId: string, suspended: boolean) {
    const subscription = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!subscription) throw new NotFoundException('This tenant has no subscription');
    const updated = await this.prisma.subscription.update({
      where: { organizationId },
      data: { manuallySuspended: suspended },
      include: { plan: true },
    });
    return { ...updated, status: effectiveStatus(updated) };
  }

  // ── Platform analytics ──────────────────────────────────────────────

  async analytics() {
    const [organizationCount, subscriptions, terminalCount] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.subscription.findMany({ include: { plan: true } }),
      this.prisma.terminal.count(),
    ]);

    const byStatus: Record<string, number> = { TRIAL: 0, ACTIVE: 0, GRACE: 0, SUSPENDED: 0 };
    let mrrKes = 0;
    for (const sub of subscriptions) {
      const status = effectiveStatus(sub);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      // MRR counts paying (non-trial), non-suspended subscriptions only -
      // a trial or a suspended tenant contributes no recurring revenue.
      if (!sub.isTrial && status !== 'SUSPENDED') {
        const monthlyEquivalent = (Number(sub.plan.priceKes) / sub.plan.billingPeriodDays) * 30;
        mrrKes += monthlyEquivalent;
      }
    }

    return {
      tenantCount: organizationCount,
      subscriptionsByStatus: byStatus,
      mrrKes: Math.round(mrrKes),
      deviceCount: terminalCount,
    };
  }
}
