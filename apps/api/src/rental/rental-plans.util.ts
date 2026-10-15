/**
 * What each ZARODA rental plan includes. Pure rules only - the database access is in rental-plans.service.ts.
 * Amounts are in KES. 'growth' and 'agency' are deliberately not here yet (enabled after 20 paying landlords).
 */
export type RentalPlanCode = 'bure' | 'starter' | 'collect';
export type RentalBillingCycle = 'monthly' | 'annual';

/** Things a plan can switch on. Bure has none of them. */
export type RentalFeature = 'portal' | 'receipts' | 'statements' | 'reminders' | 'caretaker' | 'collect';

export interface RentalPlanDef {
  code: RentalPlanCode;
  name: string;
  /** Most occupied units (units with an active lease); null = no limit. */
  unitLimit: number | null;
  /** Caretaker accounts included (each limited to the properties the landlord assigns). */
  caretakerLimit: number;
  monthlyPrice: number;
  annualPrice: number | null;
  /** Percent of rent matched through the landlord's gateway (collect only). */
  feePercent: number;
  features: RentalFeature[];
}

export const RENTAL_PLANS: Record<RentalPlanCode, RentalPlanDef> = {
  bure: { code: 'bure', name: 'Bure (free)', unitLimit: 5, caretakerLimit: 0, monthlyPrice: 0, annualPrice: null, feePercent: 0, features: [] },
  starter: {
    code: 'starter',
    name: 'Starter',
    unitLimit: 30,
    caretakerLimit: 1,
    monthlyPrice: 1000,
    annualPrice: 10000, // 12 months for the price of 10
    feePercent: 0,
    features: ['portal', 'receipts', 'statements', 'reminders', 'caretaker'],
  },
  collect: {
    code: 'collect',
    name: 'Pay-as-you-collect',
    unitLimit: null,
    caretakerLimit: 5,
    monthlyPrice: 0,
    annualPrice: null,
    feePercent: 1,
    features: ['portal', 'receipts', 'statements', 'reminders', 'caretaker', 'collect'],
  },
};

export const PLAN_ORDER: RentalPlanCode[] = ['bure', 'starter', 'collect'];
export const DEFAULT_PLAN: RentalPlanCode = 'bure';

export const isPlanCode = (value: unknown): value is RentalPlanCode => typeof value === 'string' && value in RENTAL_PLANS;

/** True when moving from one plan to the other is a step up (more features). */
export const isUpgrade = (from: RentalPlanCode, to: RentalPlanCode): boolean => PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);

/** First of next month, which is when a billing cycle starts. */
export function nextCycleStart(today: Date): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
}

export interface PlanFields {
  plan: string;
  pendingPlan: string | null;
  pendingPlanFrom: Date | null;
}

/** The plan in force now: a waiting move to a cheaper plan takes over once its date arrives. No settings row = Bure. */
export function effectivePlan(fields: PlanFields | null, now: Date = new Date()): RentalPlanDef {
  if (!fields) return RENTAL_PLANS[DEFAULT_PLAN];
  if (fields.pendingPlan && fields.pendingPlanFrom && fields.pendingPlanFrom <= now && isPlanCode(fields.pendingPlan)) {
    return RENTAL_PLANS[fields.pendingPlan];
  }
  return isPlanCode(fields.plan) ? RENTAL_PLANS[fields.plan] : RENTAL_PLANS[DEFAULT_PLAN];
}

export const planHas = (plan: RentalPlanDef, feature: RentalFeature): boolean => plan.features.includes(feature);

/** The cheapest plan that has a feature, for the upgrade message. */
export function planFor(feature: RentalFeature): RentalPlanDef {
  return RENTAL_PLANS[PLAN_ORDER.find((code) => planHas(RENTAL_PLANS[code], feature)) ?? 'collect'];
}

/** The next plan up that has room for `units` occupied units. */
export function planForUnits(units: number): RentalPlanDef {
  return RENTAL_PLANS[PLAN_ORDER.find((code) => RENTAL_PLANS[code].unitLimit === null || units <= (RENTAL_PLANS[code].unitLimit as number)) ?? 'collect'];
}

export const FEATURE_LABEL: Record<RentalFeature, string> = {
  portal: 'The tenant portal',
  receipts: 'Printable receipts',
  statements: 'Tenant statements',
  reminders: 'Rent reminders',
  caretaker: 'A caretaker account',
  collect: 'Collecting rent by M-Pesa',
};
