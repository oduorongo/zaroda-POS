-- Construction C8: what a payment is for (plan or add-on), SMS credits, payout fee bands, SMS bundles, monthly fee invoices; Enterprise branch offices, custom roles and API keys.

-- CreateEnum
CREATE TYPE "ConPaymentPurpose" AS ENUM ('PLAN', 'EXTRA_PROJECTS', 'FEES', 'SMS');

-- CreateEnum
CREATE TYPE "ConFeeInvoiceStatus" AS ENUM ('UNPAID', 'PAID');

-- AlterTable
ALTER TABLE "con_subscription_payments" ADD COLUMN     "details" JSONB,
ADD COLUMN     "purpose" "ConPaymentPurpose" NOT NULL DEFAULT 'PLAN';

-- AlterTable
ALTER TABLE "con_subscriptions" ADD COLUMN     "smsCredits" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "con_payout_fee_bands" (
    "id" TEXT NOT NULL,
    "upTo" DECIMAL(14,2),
    "darajaCost" DECIMAL(10,2) NOT NULL,
    "markup" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_payout_fee_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_sms_bundles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sms" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_sms_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_fee_charges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "projectId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "darajaCost" DECIMAL(10,2) NOT NULL,
    "markup" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_fee_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "ConFeeInvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_fee_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "con_sms_bundles_code_key" ON "con_sms_bundles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "con_fee_charges_sourceId_key" ON "con_fee_charges"("sourceId");

-- CreateIndex
CREATE INDEX "con_fee_charges_organizationId_periodMonth_idx" ON "con_fee_charges"("organizationId", "periodMonth");

-- CreateIndex
CREATE INDEX "con_fee_charges_invoiceId_idx" ON "con_fee_charges"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "con_fee_invoices_organizationId_periodMonth_key" ON "con_fee_invoices"("organizationId", "periodMonth");

-- AddForeignKey
ALTER TABLE "con_fee_charges" ADD CONSTRAINT "con_fee_charges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_fee_charges" ADD CONSTRAINT "con_fee_charges_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "con_fee_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_fee_invoices" ADD CONSTRAINT "con_fee_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Placeholder price lists - ZARODA edits them in the admin app (Construction > Price lists).
INSERT INTO "con_payout_fee_bands" ("id", "upTo", "darajaCost", "markup", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 1000, 5, 10, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 10000, 12, 10, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 70000, 20, 10, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, NULL, 30, 10, 3, CURRENT_TIMESTAMP);

INSERT INTO "con_sms_bundles" ("id", "code", "name", "sms", "price", "isActive", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'SMS_500', '500 texts', 500, 500, true, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SMS_2000', '2,000 texts', 2000, 1800, true, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SMS_5000', '5,000 texts', 5000, 4000, true, 2, CURRENT_TIMESTAMP);

-- Construction C8 Enterprise: branch offices, custom roles, read-only API keys.

-- AlterTable
ALTER TABLE "con_projects" ADD COLUMN     "officeId" TEXT;

-- CreateTable
CREATE TABLE "con_offices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "county" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_user_offices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_user_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_custom_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grants" JSONB NOT NULL DEFAULT '[]',
    "approvalLimit" DECIMAL(16,2),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_user_custom_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "customRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_user_custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "lastUsedAt" TIMESTAMP(3),
    "requests" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "con_offices_organizationId_name_key" ON "con_offices"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "con_user_offices_orgUserId_key" ON "con_user_offices"("orgUserId");

-- CreateIndex
CREATE INDEX "con_user_offices_officeId_idx" ON "con_user_offices"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "con_custom_roles_organizationId_name_key" ON "con_custom_roles"("organizationId", "name");

-- CreateIndex
CREATE INDEX "con_user_custom_roles_customRoleId_idx" ON "con_user_custom_roles"("customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "con_user_custom_roles_orgUserId_customRoleId_key" ON "con_user_custom_roles"("orgUserId", "customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "con_api_keys_prefix_key" ON "con_api_keys"("prefix");

-- CreateIndex
CREATE INDEX "con_api_keys_organizationId_idx" ON "con_api_keys"("organizationId");

-- CreateIndex
CREATE INDEX "con_projects_officeId_idx" ON "con_projects"("officeId");

-- AddForeignKey
ALTER TABLE "con_projects" ADD CONSTRAINT "con_projects_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "con_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_offices" ADD CONSTRAINT "con_offices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_offices" ADD CONSTRAINT "con_user_offices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_offices" ADD CONSTRAINT "con_user_offices_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_offices" ADD CONSTRAINT "con_user_offices_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "con_offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_custom_roles" ADD CONSTRAINT "con_custom_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_custom_roles" ADD CONSTRAINT "con_user_custom_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_custom_roles" ADD CONSTRAINT "con_user_custom_roles_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_user_custom_roles" ADD CONSTRAINT "con_user_custom_roles_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "con_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_api_keys" ADD CONSTRAINT "con_api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
