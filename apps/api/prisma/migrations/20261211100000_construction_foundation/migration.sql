-- Construction C1: plans, subscriptions, roles, compliance vault, category caps, tax settings, alerts. Additive only.

-- CreateEnum
CREATE TYPE "ConWorksClass" AS ENUM ('BUILDING', 'ROADS_CIVIL', 'ELEC_MECH');

-- CreateEnum
CREATE TYPE "ConRoleCode" AS ENUM ('CON_DIRECTOR', 'CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', 'CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER', 'CON_TIMEKEEPER', 'CON_CLIENT', 'CON_CONSULTANT_ARCH', 'CON_CONSULTANT_QS', 'CON_CONSULTANT_ENG', 'CON_SUBCONTRACTOR');

-- CreateEnum
CREATE TYPE "ConRoleScope" AS ENUM ('COMPANY', 'PROJECT', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ConDocType" AS ENUM ('NCA_CERT', 'NCA_LICENCE', 'KRA_TCC', 'BUSINESS_PERMIT', 'AGPO', 'INSURANCE_CAR', 'INSURANCE_PL', 'WIBA', 'OTHER');

-- CreateEnum
CREATE TYPE "ConBillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ConSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "con_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fits" TEXT,
    "monthlyPrice" DECIMAL(14,2) NOT NULL,
    "annualPrice" DECIMAL(14,2),
    "quoteOnly" BOOLEAN NOT NULL DEFAULT false,
    "setupFee" DECIMAL(14,2),
    "setupFeeOptional" BOOLEAN NOT NULL DEFAULT false,
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentOff" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "validUntil" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "cycle" "ConBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "status" "ConSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "addons" JSONB NOT NULL DEFAULT '{}',
    "couponCode" TEXT,
    "couponMonthsLeft" INTEGER NOT NULL DEFAULT 0,
    "paidPaymentsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_subscription_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "cycle" "ConBillingCycle" NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "couponCode" TEXT,
    "status" "ConPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL DEFAULT 'MPESA',
    "phone" TEXT,
    "tumaMerchantRequestId" TEXT,
    "receipt" TEXT,
    "error" TEXT,
    "paidAt" TIMESTAMP(3),
    "periodEndAfter" TIMESTAMP(3),
    "recordedByPlatformAdminId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" "ConRoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "ConRoleScope" NOT NULL,
    "approvalLimit" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_user_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "role" "ConRoleCode" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_project_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "role" "ConRoleCode" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_company_registrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "worksClass" "ConWorksClass" NOT NULL,
    "ncaCategory" INTEGER NOT NULL,
    "regNo" TEXT NOT NULL,
    "registeredAt" DATE,
    "licenceExpiresAt" DATE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_company_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_compliance_docs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ConDocType" NOT NULL,
    "title" TEXT NOT NULL,
    "refNo" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "projectId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_compliance_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_category_limits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "worksClass" "ConWorksClass" NOT NULL,
    "ncaCategory" INTEGER NOT NULL,
    "maxValue" DECIMAL(16,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_category_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_tax_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "threshold" DECIMAL(16,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "con_plans_code_key" ON "con_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "con_coupons_code_key" ON "con_coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "con_subscriptions_organizationId_key" ON "con_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "con_subscription_payments_organizationId_idx" ON "con_subscription_payments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_roles_organizationId_code_key" ON "con_roles"("organizationId", "code");

-- CreateIndex
CREATE INDEX "con_user_roles_organizationId_idx" ON "con_user_roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_user_roles_orgUserId_role_key" ON "con_user_roles"("orgUserId", "role");

-- CreateIndex
CREATE INDEX "con_project_members_organizationId_idx" ON "con_project_members"("organizationId");

-- CreateIndex
CREATE INDEX "con_project_members_orgUserId_idx" ON "con_project_members"("orgUserId");

-- CreateIndex
CREATE UNIQUE INDEX "con_project_members_projectId_orgUserId_role_key" ON "con_project_members"("projectId", "orgUserId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "con_company_registrations_organizationId_worksClass_key" ON "con_company_registrations"("organizationId", "worksClass");

-- CreateIndex
CREATE INDEX "con_compliance_docs_organizationId_expiresAt_idx" ON "con_compliance_docs"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "con_category_limits_organizationId_worksClass_ncaCategory_key" ON "con_category_limits"("organizationId", "worksClass", "ncaCategory");

-- CreateIndex
CREATE UNIQUE INDEX "con_tax_settings_organizationId_key_effectiveFrom_key" ON "con_tax_settings"("organizationId", "key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "con_alerts_organizationId_dedupeKey_key" ON "con_alerts"("organizationId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "con_subscriptions" ADD CONSTRAINT "con_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_subscription_payments" ADD CONSTRAINT "con_subscription_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_roles" ADD CONSTRAINT "con_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_roles" ADD CONSTRAINT "con_user_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_roles" ADD CONSTRAINT "con_user_roles_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_members" ADD CONSTRAINT "con_project_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_members" ADD CONSTRAINT "con_project_members_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_company_registrations" ADD CONSTRAINT "con_company_registrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_compliance_docs" ADD CONSTRAINT "con_compliance_docs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_category_limits" ADD CONSTRAINT "con_category_limits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_tax_settings" ADD CONSTRAINT "con_tax_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_alerts" ADD CONSTRAINT "con_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: construction plans (docs/construction/05-pricing-plans.md) and the pilot coupon. Editable later by the super-admin.
INSERT INTO "con_plans" ("id", "code", "name", "fits", "monthlyPrice", "annualPrice", "quoteOnly", "setupFee", "setupFeeOptional", "limits", "features", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'CON_MJENGO', 'Mjengo', 'One site at a time', 1500, 15000, false, 3000, true, '{"activeProjects":1,"workers":10,"users":2}', '["compliance","projects","labour","safety","procurement","commercial","etims"]', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CON_FUNDI', 'Fundi', 'NCA 7-8', 3500, 35000, false, NULL, false, '{"activeProjects":2,"workers":30,"users":5}', '["compliance","projects","labour","safety","tenders","procurement","commercial","etims","extra_projects"]', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CON_CONTRACTOR', 'Contractor', 'NCA 5-6', 9500, 95000, false, NULL, false, '{"activeProjects":6,"workers":150,"users":15}', '["compliance","projects","labour","safety","tenders","procurement","approval_limits","commercial","etims","payroll","portal","plant","full_reports","extra_projects"]', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CON_PRO', 'Pro', 'NCA 3-4', 25000, 250000, false, NULL, false, '{"activeProjects":20,"workers":null,"users":50}', '["compliance","projects","labour","safety","tenders","procurement","approval_limits","commercial","etims","payroll","portal","plant","full_reports","subcontracts","extra_projects"]', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CON_ENTERPRISE', 'Enterprise', 'NCA 1-2', 60000, NULL, true, NULL, false, '{"activeProjects":null,"workers":null,"users":null}', '["compliance","projects","labour","safety","tenders","procurement","approval_limits","commercial","etims","payroll","portal","plant","full_reports","subcontracts","multi_branch","custom_roles","api"]', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "con_coupons" ("id", "code", "description", "percentOff", "months", "updatedAt") VALUES
  (gen_random_uuid()::text, 'PILOT50', 'Pilot contractors: 50% off for 2 months', 50, 2, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
