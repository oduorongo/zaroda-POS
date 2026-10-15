import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { paymentsReady } from '../online-store/payment-gateway';
import { nairobiToday } from './rental-billing.util';
import { ChangePlanDto } from './dto/rental-plans.dto';
import {
  FEATURE_LABEL,
  PLAN_ORDER,
  RENTAL_PLANS,
  RentalFeature,
  RentalPlanDef,
  effectivePlan,
  isUpgrade,
  nextCycleStart,
  planFor,
  planForUnits,
  planHas,
} from './rental-plans.util';

type Tx = Prisma.TransactionClient;

/** 402 Payment Required: the screen reads it as "show the upgrade prompt", not as a failure. */
function upgradeRequired(message: string, code: 'PLAN_LIMIT' | 'PLAN_FEATURE', suggestedPlan: string): HttpException {
  return new HttpException({ statusCode: 402, error: 'Upgrade needed', code, suggestedPlan, message }, 402);
}

/** The plan in force for a landlord, read inside whatever business context `tx` is already in. */
export async function loadPlan(tx: Tx, organizationId: string, now: Date = new Date()): Promise<RentalPlanDef> {
  return effectivePlan(await tx.rentalSettings.findUnique({ where: { organizationId } }), now);
}

export const countOccupiedUnits = (tx: Tx, organizationId: string): Promise<number> =>
  tx.rentalLease.count({ where: { organizationId, status: 'ACTIVE' } });

/** Called before a unit becomes occupied: Bure stops at its 5th unit, Starter at its 30th. */
export async function assertUnitRoom(tx: Tx, organizationId: string): Promise<void> {
  const plan = await loadPlan(tx, organizationId);
  if (plan.unitLimit === null) return;
  const occupied = await countOccupiedUnits(tx, organizationId);
  if (occupied < plan.unitLimit) return;
  const next = planForUnits(occupied + 1);
  throw upgradeRequired(
    `The ${plan.name} plan covers up to ${plan.unitLimit} occupied units and you have ${occupied}. Upgrade to ${next.name} to add more.`,
    'PLAN_LIMIT',
    next.code,
  );
}

export async function assertFeature(tx: Tx, organizationId: string, feature: RentalFeature): Promise<void> {
  const plan = await loadPlan(tx, organizationId);
  if (planHas(plan, feature)) return;
  const needed = planFor(feature);
  throw upgradeRequired(`${FEATURE_LABEL[feature]} comes with the ${needed.name} plan. You are on ${plan.name}.`, 'PLAN_FEATURE', needed.code);
}

/** The landlord's own view of their plan, and changing it. */
@Injectable()
export class RentalPlansService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async assertFeature(feature: RentalFeature): Promise<void> {
    const { organizationId } = getTenantStore();
    await this.tenantPrisma.run((tx) => assertFeature(tx, organizationId, feature));
  }

  async getPlan() {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const settings = await tx.rentalSettings.findUnique({ where: { organizationId } });
      const plan = effectivePlan(settings);
      const occupiedUnits = await countOccupiedUnits(tx, organizationId);
      return {
        plan: plan.code,
        name: plan.name,
        unitLimit: plan.unitLimit,
        occupiedUnits,
        features: plan.features,
        billingCycle: settings?.billingCycle ?? 'monthly',
        pendingPlan: settings?.pendingPlan && settings.pendingPlanFrom && settings.pendingPlanFrom > new Date() ? settings.pendingPlan : null,
        pendingPlanFrom: settings?.pendingPlanFrom && settings.pendingPlanFrom > new Date() ? settings.pendingPlanFrom : null,
        freeUntil: settings?.planFreeUntil && settings.planFreeUntil > new Date() ? settings.planFreeUntil : null,
        foundingPriceUntil: settings?.foundingPriceUntil ?? null,
        gatewayReady: settings ? paymentsReady(settings) : false,
        plans: PLAN_ORDER.map((code) => RENTAL_PLANS[code]),
      };
    });
  }

  /** Up applies at once; down waits for the next cycle, and only if the units still fit. */
  async changePlan(dto: ChangePlanDto) {
    const { organizationId } = getTenantStore();
    const target = RENTAL_PLANS[dto.plan];
    const cycle = target.annualPrice === null ? 'monthly' : dto.billingCycle ?? 'monthly';

    await this.tenantPrisma.run(async (tx) => {
      const settings = await tx.rentalSettings.findUnique({ where: { organizationId } });
      const current = effectivePlan(settings);

      if (target.code === 'collect' && !(settings && paymentsReady(settings))) {
        throw new BadRequestException('Connect your Tuma account or your own Paybill/Till first (Rent > M-Pesa settings), then choose this plan.');
      }
      if (target.unitLimit !== null) {
        const occupied = await countOccupiedUnits(tx, organizationId);
        if (occupied > target.unitLimit) {
          throw new BadRequestException(`You have ${occupied} occupied units and ${target.name} covers ${target.unitLimit}. Choose a bigger plan.`);
        }
      }

      let data: Prisma.RentalSettingsUncheckedUpdateInput;
      if (target.code === current.code) {
        // Same plan: this only cancels a waiting move and/or changes monthly/annual.
        data = { plan: target.code, billingCycle: cycle, pendingPlan: null, pendingPlanFrom: null };
      } else if (isUpgrade(current.code, target.code)) {
        data = { plan: target.code, billingCycle: cycle, pendingPlan: null, pendingPlanFrom: null };
      } else {
        data = { pendingPlan: target.code, pendingPlanFrom: nextCycleStart(nairobiToday()) };
      }
      await tx.rentalSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...(data as Prisma.RentalSettingsUncheckedCreateInput) },
        update: data,
      });
    });
    return this.getPlan();
  }
}
