import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Idempotent (upsert on the unique `tier`) - safe to re-run, e.g. after
 * pulling a schema change that adds a new tier. Prices are placeholders
 * for the pilot; edit via PATCH /platform-admin/plans once the platform
 * admin UI's Billing screen is live rather than re-running this script
 * for a price change.
 *
 * Run: pnpm --filter api seed:plans
 */
const DEFAULT_PLANS = [
  { tier: "BASIC", name: "Basic", priceKes: 2500, maxDevices: 1, maxBranches: 1 },
  { tier: "STANDARD", name: "Standard", priceKes: 6000, maxDevices: 3, maxBranches: 1 },
  { tier: "PREMIUM", name: "Premium", priceKes: 15000, maxDevices: 10, maxBranches: 5 },
] as const;

async function main() {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      update: {},
      create: { ...plan, billingPeriodDays: 30 },
    });
    console.log(`Ensured plan: ${plan.tier}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
