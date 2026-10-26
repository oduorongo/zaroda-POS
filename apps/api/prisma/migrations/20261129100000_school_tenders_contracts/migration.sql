-- School supplier: tenders (register, checklist, bid costing, compliance documents) and contracts (value, variations, orders and invoices charged to them). Additive only.
-- CreateEnum
CREATE TYPE "SchoolTenderStatus" AS ENUM ('IDENTIFIED', 'PREPARING', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SchoolContractStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TERMINATED');

-- AlterTable
ALTER TABLE "school_orders" ADD COLUMN     "contractId" TEXT;

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "contractId" TEXT;

-- CreateTable
CREATE TABLE "school_tenders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT,
    "entityName" TEXT NOT NULL,
    "tenderNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SchoolTenderStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "closingDate" DATE,
    "submittedOn" DATE,
    "bidAmount" DECIMAL(14,2),
    "submitOverride" TEXT,
    "outcomeNote" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "school_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_tender_checks" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

CONSTRAINT "school_tender_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_tender_lines" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "variantId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

CONSTRAINT "school_tender_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_compliance_docs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "issuedOn" DATE,
    "expiryDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "school_compliance_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_contracts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "tenderId" TEXT,
    "contractNumber" TEXT NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "status" "SchoolContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "school_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_contract_variations" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "school_contract_variations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "school_tenders_organizationId_status_idx" ON "school_tenders"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "school_tenders_organizationId_tenderNumber_key" ON "school_tenders"("organizationId", "tenderNumber");

-- CreateIndex
CREATE INDEX "school_tender_checks_tenderId_idx" ON "school_tender_checks"("tenderId");

-- CreateIndex
CREATE INDEX "school_tender_lines_tenderId_idx" ON "school_tender_lines"("tenderId");

-- CreateIndex
CREATE INDEX "school_compliance_docs_organizationId_idx" ON "school_compliance_docs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "school_contracts_tenderId_key" ON "school_contracts"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "school_contracts_contractNumber_key" ON "school_contracts"("contractNumber");

-- CreateIndex
CREATE INDEX "school_contracts_organizationId_status_idx" ON "school_contracts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "school_contracts_schoolId_idx" ON "school_contracts"("schoolId");

-- CreateIndex
CREATE INDEX "school_contract_variations_contractId_idx" ON "school_contract_variations"("contractId");

-- CreateIndex
CREATE INDEX "school_orders_contractId_idx" ON "school_orders"("contractId");

-- CreateIndex
CREATE INDEX "supplier_invoices_contractId_idx" ON "supplier_invoices"("contractId");

-- AddForeignKey
ALTER TABLE "school_tenders" ADD CONSTRAINT "school_tenders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_tenders" ADD CONSTRAINT "school_tenders_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_tender_checks" ADD CONSTRAINT "school_tender_checks_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "school_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_tender_lines" ADD CONSTRAINT "school_tender_lines_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "school_tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_tender_lines" ADD CONSTRAINT "school_tender_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_compliance_docs" ADD CONSTRAINT "school_compliance_docs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_contracts" ADD CONSTRAINT "school_contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_contracts" ADD CONSTRAINT "school_contracts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_contracts" ADD CONSTRAINT "school_contracts_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "school_tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_contract_variations" ADD CONSTRAINT "school_contract_variations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "school_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_orders" ADD CONSTRAINT "school_orders_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "school_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "school_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
