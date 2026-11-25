-- CreateEnum
CREATE TYPE "FarmMusterStatus" AS ENUM ('PRESENT', 'HALF_DAY', 'ABSENT');

-- CreateEnum
CREATE TYPE "FarmWageRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "FarmWageLineStatus" AS ENUM ('UNPAID', 'SENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "FarmPayMethod" AS ENUM ('MPESA', 'MPESA_MANUAL', 'CASH');

-- CreateEnum
CREATE TYPE "FarmBuyerKind" AS ENUM ('COOP', 'PROCESSOR', 'HOTEL', 'SCHOOL', 'SHOP', 'PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "FarmBuyerPayMethod" AS ENUM ('CASH', 'MPESA', 'BANK', 'CHEQUE');

-- CreateTable
CREATE TABLE "farm_workers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "idNumber" TEXT,
    "dailyRate" DECIMAL(14,2) NOT NULL,
    "unitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_muster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "FarmMusterStatus" NOT NULL,
    "task" TEXT,
    "unitId" TEXT,
    "enterpriseId" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_muster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_wage_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "FarmWageRunStatus" NOT NULL DEFAULT 'DRAFT',
    "workers" INTEGER NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_wage_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_wage_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "dailyRate" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "nssf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shif" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "housingLevy" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paye" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL,
    "status" "FarmWageLineStatus" NOT NULL DEFAULT 'UNPAID',
    "method" "FarmPayMethod",
    "reference" TEXT,
    "requestId" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "smsSentAt" TIMESTAMP(3),

    CONSTRAINT "farm_wage_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_payout_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "shortcode" TEXT,
    "initiator" TEXT,
    "consumerKeyEncrypted" TEXT,
    "consumerSecretEncrypted" TEXT,
    "securityCredentialEncrypted" TEXT,
    "callbackSecret" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_payout_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_buyers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FarmBuyerKind" NOT NULL DEFAULT 'OTHER',
    "phone" TEXT,
    "email" TEXT,
    "kraPin" TEXT,
    "memberNo" TEXT,
    "creditLimit" DECIMAL(14,2),
    "termsDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "session" "FarmMilkSession",
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "enterpriseId" TEXT,
    "slipNo" TEXT,
    "stockBranchId" TEXT,
    "overLimit" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_buyer_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "FarmBuyerPayMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_buyer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_product_tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,

    CONSTRAINT "farm_product_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "farm_workers_organizationId_active_idx" ON "farm_workers"("organizationId", "active");

-- CreateIndex
CREATE INDEX "farm_muster_organizationId_date_idx" ON "farm_muster"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "farm_muster_workerId_date_key" ON "farm_muster"("workerId", "date");

-- CreateIndex
CREATE INDEX "farm_wage_runs_organizationId_periodStart_idx" ON "farm_wage_runs"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "farm_wage_runs_organizationId_number_key" ON "farm_wage_runs"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "farm_wage_lines_requestId_key" ON "farm_wage_lines"("requestId");

-- CreateIndex
CREATE INDEX "farm_wage_lines_organizationId_runId_idx" ON "farm_wage_lines"("organizationId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "farm_payout_settings_organizationId_key" ON "farm_payout_settings"("organizationId");

-- CreateIndex
CREATE INDEX "farm_buyers_organizationId_active_idx" ON "farm_buyers"("organizationId", "active");

-- CreateIndex
CREATE INDEX "farm_deliveries_organizationId_buyerId_date_idx" ON "farm_deliveries"("organizationId", "buyerId", "date");

-- CreateIndex
CREATE INDEX "farm_buyer_payments_organizationId_buyerId_date_idx" ON "farm_buyer_payments"("organizationId", "buyerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "farm_product_tags_organizationId_variantId_key" ON "farm_product_tags"("organizationId", "variantId");

