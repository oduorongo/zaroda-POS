-- School supplier: the 13-week cash-flow forecast - the cash to start from and the least wanted, and planned money in and out (can repeat). Additive only.
-- CreateEnum
CREATE TYPE "CashflowDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashflowRepeat" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "school_cashflow_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openingCash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingCashAsOf" DATE,
    "minimumCash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "school_cashflow_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_cashflow_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" "CashflowDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "repeat" "CashflowRepeat" NOT NULL DEFAULT 'NONE',
    "repeatUntil" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "school_cashflow_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_cashflow_settings_organizationId_key" ON "school_cashflow_settings"("organizationId");

-- CreateIndex
CREATE INDEX "school_cashflow_items_organizationId_active_idx" ON "school_cashflow_items"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "school_cashflow_settings" ADD CONSTRAINT "school_cashflow_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_cashflow_items" ADD CONSTRAINT "school_cashflow_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
