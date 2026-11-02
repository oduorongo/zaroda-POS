-- Seasonal (school-term) billing for school suppliers. Existing plans stay MONTHLY; every existing payment stays commissionable.

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "annualPriceKes" DECIMAL(12,2),
ADD COLUMN     "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "commissionable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "seasonal_terms" (
    "term" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "shareRate" DECIMAL(5,4) NOT NULL,
    "dueMonth" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "fromMonth" INTEGER NOT NULL,
    "toMonth" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonal_terms_pkey" PRIMARY KEY ("term")
);

-- CreateTable
CREATE TABLE "seasonal_billing_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "payInFullDiscountRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "payInFullUntilMonth" INTEGER NOT NULL DEFAULT 1,
    "minFirstPaymentKes" DECIMAL(12,2) NOT NULL DEFAULT 1500,
    "setupFeeKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedByPlatformAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonal_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_instalments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "schoolYear" INTEGER NOT NULL,
    "term" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "payPhone" TEXT,
    "payAttemptedAt" TIMESTAMP(3),
    "tumaMerchantRequestId" TEXT,
    "attemptFullYear" BOOLEAN NOT NULL DEFAULT false,
    "attemptAmount" DECIMAL(12,2),
    "lastPaymentError" TEXT,
    "reminders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_due_shifts" (
    "id" TEXT NOT NULL,
    "schoolYear" INTEGER NOT NULL,
    "term" INTEGER NOT NULL,
    "newDueDate" DATE NOT NULL,
    "instalments" INTEGER NOT NULL,
    "reason" TEXT,
    "platformAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasonal_due_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_instalments_organizationId_status_idx" ON "subscription_instalments"("organizationId", "status");

-- CreateIndex
CREATE INDEX "subscription_instalments_schoolYear_term_status_idx" ON "subscription_instalments"("schoolYear", "term", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_instalments_subscriptionId_schoolYear_term_key" ON "subscription_instalments"("subscriptionId", "schoolYear", "term");

-- AddForeignKey
ALTER TABLE "subscription_instalments" ADD CONSTRAINT "subscription_instalments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_instalments" ADD CONSTRAINT "subscription_instalments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The default terms (editable by the platform admin): 50% due 15 Jan, 30% due 15 May, 20% due 15 Sep, 30 days' grace each.
INSERT INTO "seasonal_terms" ("term", "label", "shareRate", "dueMonth", "dueDay", "graceDays", "fromMonth", "toMonth", "updatedAt") VALUES
  (1, 'Term 1', 0.5000, 1, 15, 30, 1, 4, CURRENT_TIMESTAMP),
  (2, 'Term 2', 0.3000, 5, 15, 30, 5, 8, CURRENT_TIMESTAMP),
  (3, 'Term 3', 0.2000, 9, 15, 30, 9, 10, CURRENT_TIMESTAMP)
ON CONFLICT ("term") DO NOTHING;

INSERT INTO "seasonal_billing_settings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;

-- The plan school suppliers start on. The price is a placeholder for ZARODA to set (Platform admin > Plans).
INSERT INTO "plans" ("id", "tier", "name", "priceKes", "billingPeriodDays", "billingCycle", "annualPriceKes", "maxDevices", "maxBranches", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'SEASONAL', 'School Supplier (per term)', 12000, 365, 'SEASONAL', 12000, 2, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("tier") DO NOTHING;
