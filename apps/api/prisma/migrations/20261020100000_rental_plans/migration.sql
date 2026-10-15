-- AlterTable
ALTER TABLE "rental_settings"
  ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'bure',
  ADD COLUMN "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN "pendingPlan" TEXT,
  ADD COLUMN "pendingPlanFrom" TIMESTAMP(3),
  ADD COLUMN "foundingPriceUntil" TIMESTAMP(3),
  ADD COLUMN "planFreeUntil" TIMESTAMP(3);

-- Landlords already using rentals keep everything they have today (all features, no unit limit) at no charge until
-- the end of October 2026, so nothing breaks while plans are introduced. They choose a plan before then.
INSERT INTO "rental_settings" ("id", "organizationId", "plan", "planFreeUntil", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'collect', TIMESTAMP '2026-10-31 20:59:59', CURRENT_TIMESTAMP
FROM "organizations" o
WHERE o."industryType" = 'RENTAL'
  AND NOT EXISTS (SELECT 1 FROM "rental_settings" rs WHERE rs."organizationId" = o."id");

UPDATE "rental_settings" rs
SET "plan" = 'collect', "planFreeUntil" = TIMESTAMP '2026-10-31 20:59:59'
FROM "organizations" o
WHERE o."id" = rs."organizationId" AND o."industryType" = 'RENTAL';
