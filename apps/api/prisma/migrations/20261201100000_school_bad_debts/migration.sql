-- School supplier: bad debts - the provision (an estimate of what will not be paid), write-offs with a second approver, and the history. Additive only.
-- AlterEnum
ALTER TYPE "SupplierInvoiceStatus" ADD VALUE 'WRITTEN_OFF';

-- CreateEnum
CREATE TYPE "WriteOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVERSED');

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "writtenOffAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "school_bad_debt_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rate1To30" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "rate31To60" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "rate61To90" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "rate91To180" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "rateOver180" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "approvalThreshold" DECIMAL(12,2) NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "school_bad_debt_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_write_offs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WriteOffStatus" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "overrideReason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByName" TEXT,
    "reversalReason" TEXT,

CONSTRAINT "school_write_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_provision_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "previous" DECIMAL(14,2) NOT NULL,
    "overdue" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "school_provision_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_bad_debt_settings_organizationId_key" ON "school_bad_debt_settings"("organizationId");

-- CreateIndex
CREATE INDEX "school_write_offs_organizationId_status_idx" ON "school_write_offs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "school_write_offs_invoiceId_idx" ON "school_write_offs"("invoiceId");

-- CreateIndex
CREATE INDEX "school_provision_entries_organizationId_asOf_idx" ON "school_provision_entries"("organizationId", "asOf");

-- AddForeignKey
ALTER TABLE "school_bad_debt_settings" ADD CONSTRAINT "school_bad_debt_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_write_offs" ADD CONSTRAINT "school_write_offs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_write_offs" ADD CONSTRAINT "school_write_offs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_provision_entries" ADD CONSTRAINT "school_provision_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
