-- CreateEnum
CREATE TYPE "FarmPaymentPurpose" AS ENUM ('PLAN', 'SMS', 'FEES');

-- CreateEnum
CREATE TYPE "FarmPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "farm_subscriptions" ADD COLUMN     "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "paidPaymentsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "smsCredits" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "farm_subscription_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purpose" "FarmPaymentPurpose" NOT NULL DEFAULT 'PLAN',
    "planCode" TEXT NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "months" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "details" JSONB,
    "phone" TEXT,
    "status" "FarmPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "tumaMerchantRequestId" TEXT,
    "error" TEXT,
    "method" TEXT,
    "receipt" TEXT,
    "paidAt" TIMESTAMP(3),
    "periodEndAfter" TIMESTAMP(3),
    "createdBy" TEXT,
    "recordedByPlatformAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_fee_charges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYOUT',
    "sourceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "darajaCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "markup" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_fee_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_fee_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "farm_subscription_payments_organizationId_status_idx" ON "farm_subscription_payments"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "farm_fee_charges_sourceId_key" ON "farm_fee_charges"("sourceId");

-- CreateIndex
CREATE INDEX "farm_fee_charges_organizationId_periodMonth_idx" ON "farm_fee_charges"("organizationId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "farm_fee_invoices_organizationId_periodMonth_key" ON "farm_fee_invoices"("organizationId", "periodMonth");

