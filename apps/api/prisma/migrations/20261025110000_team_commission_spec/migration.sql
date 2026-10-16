-- Marketing team commission spec (15 Oct 2026): subscription share, earning window, payout cap, the pending ->
-- payable hold, payout settings (minimum, day, hold, withholding tax) and gateway payouts.

-- CreateEnum
CREATE TYPE "SalesPayoutStatus" AS ENUM ('QUEUED', 'PAID', 'FAILED');

-- Teams: new terms, and the spec's defaults for teams created from now on (existing teams keep their own values).
ALTER TABLE "sales_teams"
  ADD COLUMN "subscriptionShareRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
  ADD COLUMN "earningMonths" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "payoutCapRate" DECIMAL(5,4) NOT NULL DEFAULT 0.35,
  ALTER COLUMN "memberShareRate" SET DEFAULT 0.25,
  ALTER COLUMN "leaderOverrideRate" SET DEFAULT 0.05,
  ALTER COLUMN "onboardingBonusKes" SET DEFAULT 500;

-- Where each person is paid.
ALTER TABLE "sales_agents" ADD COLUMN "payoutGateway" TEXT, ADD COLUMN "payoutAccount" TEXT;

-- Shops: when the current member took over (sign-up date for every shop so far).
ALTER TABLE "organizations" ADD COLUMN "salesAssignedAt" TIMESTAMP(3);
UPDATE "organizations" SET "salesAssignedAt" = "createdAt" WHERE "salesAgentId" IS NOT NULL;

-- Earnings: cap and void markers, new default status. Rows already ACCRUED become PENDING or PAYABLE by the
-- default 30-day hold after the end of the month they were earned in (Nairobi time).
ALTER TABLE "sales_earnings" ADD COLUMN "capped" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "note" TEXT;
ALTER TABLE "sales_earnings" ALTER COLUMN "status" SET DEFAULT 'PENDING';
UPDATE "sales_earnings"
SET "status" = CASE
  WHEN (to_date("periodMonth" || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' + INTERVAL '30 days') <= (now() AT TIME ZONE 'Africa/Nairobi')
  THEN 'PAYABLE'::"SalesEarningStatus" ELSE 'PENDING'::"SalesEarningStatus" END
WHERE "status" = 'ACCRUED';
CREATE INDEX "sales_earnings_organizationId_periodMonth_idx" ON "sales_earnings"("organizationId", "periodMonth");

-- Payouts: tax, status, gateway request; a payout can now be queued (no paid date yet) or automatic (no admin).
ALTER TABLE "sales_payouts"
  ADD COLUMN "taxWithheldKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "status" "SalesPayoutStatus" NOT NULL DEFAULT 'PAID',
  ADD COLUMN "gatewayRequestId" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "recordedByPlatformAdminId" DROP NOT NULL,
  ALTER COLUMN "paidAt" DROP NOT NULL,
  ALTER COLUMN "paidAt" DROP DEFAULT;
CREATE INDEX "sales_payouts_gatewayRequestId_idx" ON "sales_payouts"("gatewayRequestId");

-- CreateTable
CREATE TABLE "sales_payout_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "payoutGateway" TEXT NOT NULL DEFAULT 'MANUAL',
    "payoutMinKes" DECIMAL(12,2) NOT NULL DEFAULT 500,
    "payoutDay" INTEGER NOT NULL DEFAULT 5,
    "holdDays" INTEGER NOT NULL DEFAULT 30,
    "withholdingTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "lastRunMonth" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_payout_settings_pkey" PRIMARY KEY ("id")
);
