-- New ZARODA POS pricing (2026-11-25): monthly, annual and annual-in-instalments billing; Business plan; extra till on any plan;
-- School Supplier in 2 termly instalments. Businesses that have paid keep their current price unless they switch.

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "extraTillAnnualKes" DECIMAL(12,2) NOT NULL DEFAULT 5000,
ADD COLUMN     "extraTillKes" DECIMAL(12,2) NOT NULL DEFAULT 500,
ADD COLUMN     "instalmentCount" INTEGER,
ADD COLUMN     "instalmentKes" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingChoice" TEXT NOT NULL DEFAULT 'MONTHLY';

-- 1. Paying Basic and Standard businesses keep what they pay now: their price is written onto their own subscription
--    (a Basic business with an agreed price already has it). Trials have never paid, so they get the new prices.
UPDATE "subscriptions" s
SET "agreedPriceKes" = p."priceKes"
FROM "plans" p
WHERE s."planId" = p."id" AND p."tier" IN ('BASIC', 'STANDARD') AND s."isTrial" = false AND s."agreedPriceKes" IS NULL;

-- 2. The new prices.
UPDATE "plans" SET "priceKes" = 1000, "minPriceKes" = NULL, "annualPriceKes" = 10000, "instalmentCount" = 3, "instalmentKes" = 3500,
  "maxDevices" = 1, "maxBranches" = 1, "maxExtraTills" = GREATEST("maxExtraTills", 10), "updatedAt" = CURRENT_TIMESTAMP
WHERE "tier" = 'BASIC';

UPDATE "plans" SET "priceKes" = 3500, "annualPriceKes" = 35000, "instalmentCount" = 3, "instalmentKes" = 12000,
  "maxDevices" = 3, "maxBranches" = 1, "maxExtraTills" = GREATEST("maxExtraTills", 10), "updatedAt" = CURRENT_TIMESTAMP
WHERE "tier" = 'STANDARD';

INSERT INTO "plans" ("id", "tier", "name", "priceKes", "billingPeriodDays", "billingCycle", "annualPriceKes", "instalmentCount", "instalmentKes",
  "maxDevices", "maxBranches", "maxExtraTills", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'BUSINESS', 'Business', 7500, 30, 'MONTHLY', 75000, 4, 19500, 10, 3, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("tier") DO UPDATE SET "priceKes" = 7500, "annualPriceKes" = 75000, "instalmentCount" = 4, "instalmentKes" = 19500,
  "maxDevices" = 10, "maxBranches" = 3, "maxExtraTills" = 10, "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "plans" SET "name" = 'School Supplier', "annualPriceKes" = 12000, "priceKes" = 12000, "instalmentCount" = 2, "instalmentKes" = 6000,
  "maxDevices" = 2, "maxBranches" = 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "tier" = 'SEASONAL';

-- 3. Premium businesses move to Business (KES 7,500), but only those that fit it (3 branches at most). A Premium business with
--    more branches stays on Premium so nothing it uses is cut off. Premium then comes off sale.
UPDATE "subscriptions" s
SET "planId" = (SELECT "id" FROM "plans" WHERE "tier" = 'BUSINESS'), "agreedPriceKes" = NULL, "extraTills" = LEAST(s."extraTills", 10), "updatedAt" = CURRENT_TIMESTAMP
FROM "plans" p
WHERE s."planId" = p."id" AND p."tier" = 'PREMIUM'
  AND (SELECT count(*) FROM "branches" b WHERE b."organizationId" = s."organizationId") <= 3;

UPDATE "plans" SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "tier" = 'PREMIUM';

-- 4. School Supplier: 2 termly instalments, half in Term 1 and half by Term 2 (Term 3 no longer charged; a business joining in
--    September or October counts as Term 2).
UPDATE "seasonal_terms" SET "shareRate" = 0.5000, "updatedAt" = CURRENT_TIMESTAMP WHERE "term" = 1;
UPDATE "seasonal_terms" SET "shareRate" = 0.5000, "toMonth" = 10, "updatedAt" = CURRENT_TIMESTAMP WHERE "term" = 2;
DELETE FROM "seasonal_terms" WHERE "term" >= 3;

-- 5. Every school supplier's school years that have not started and have nothing paid are re-cut into the 2 instalments (from
--    the next school year on). This year's remaining instalments keep their dates and amounts, so nothing falls due at once.
CREATE TEMP TABLE "recut" AS
SELECT i."subscriptionId", i."organizationId", i."schoolYear", max(i."graceDays") AS "graceDays",
  COALESCE(p."annualPriceKes", p."priceKes") AS "annual"
FROM "subscription_instalments" i
JOIN "subscriptions" s ON s."id" = i."subscriptionId"
JOIN "plans" p ON p."id" = s."planId"
WHERE i."term" > 0 AND i."schoolYear" > EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Nairobi'))::int
GROUP BY i."subscriptionId", i."organizationId", i."schoolYear", p."annualPriceKes", p."priceKes"
HAVING bool_and(i."status" = 'DUE');

DELETE FROM "subscription_instalments" i
USING "recut" r
WHERE i."subscriptionId" = r."subscriptionId" AND i."schoolYear" = r."schoolYear" AND i."term" > 0;

INSERT INTO "subscription_instalments" ("id", "organizationId", "subscriptionId", "schoolYear", "term", "amount", "dueDate", "graceDays", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, r."organizationId", r."subscriptionId", r."schoolYear", t."term", round(r."annual" * t."shareRate"),
  make_date(r."schoolYear", t."dueMonth", t."dueDay"), t."graceDays", 'DUE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "recut" r CROSS JOIN "seasonal_terms" t;

DROP TABLE "recut";
