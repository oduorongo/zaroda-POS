-- Construction C5: variations, valuations / IPCs and their lines and receipts, retention ledger, subcontracts and their valuations. Additive only.

-- CreateEnum
CREATE TYPE "ConVariationStatus" AS ENUM ('PROPOSED', 'PRICED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConValuationKind" AS ENUM ('VALUATION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ConValuationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CERTIFIED', 'PAID');

-- CreateEnum
CREATE TYPE "ConRetentionType" AS ENUM ('DEDUCT', 'RELEASE');

-- CreateEnum
CREATE TYPE "ConReceiptKind" AS ENUM ('PAYMENT', 'WHT', 'WHT_VAT');

-- CreateEnum
CREATE TYPE "ConSubValuationStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "con_variations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "instructionId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "status" "ConVariationStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_valuations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "ConValuationKind" NOT NULL DEFAULT 'VALUATION',
    "reversesId" TEXT,
    "periodEnd" DATE NOT NULL,
    "workToDate" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "variationsToDate" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "materialsOnSite" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "grossToDate" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "retentionRate" DECIMAL(5,2) NOT NULL,
    "retentionDeducted" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "retentionReleased" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "retentionHeld" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "advanceRecovery" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "previousCertified" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "netDue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" "ConValuationStatus" NOT NULL DEFAULT 'DRAFT',
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "certifiedByName" TEXT,
    "certifiedRef" TEXT,
    "certifiedAt" DATE,
    "certifiedRecordedBy" TEXT,
    "vatRate" DECIMAL(6,2),
    "vatAmount" DECIMAL(16,2),
    "invoiceTotal" DECIMAL(16,2),
    "saleId" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_valuation_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "bqItemId" TEXT,
    "variationId" TEXT,
    "qtyToDate" DECIMAL(14,3),
    "amountToDate" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "con_valuation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_valuation_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "kind" "ConReceiptKind" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "certificateNo" TEXT,
    "receivedAt" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_valuation_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_retention_ledger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "valuationId" TEXT,
    "type" "ConRetentionType" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_retention_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_subcontracts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sum" DECIMAL(16,2) NOT NULL,
    "retentionRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "retentionLimit" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_subcontracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_sub_valuations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "grossToDate" DECIMAL(16,2) NOT NULL,
    "retention" DECIMAL(16,2) NOT NULL,
    "previousPaid" DECIMAL(16,2) NOT NULL,
    "netDue" DECIMAL(16,2) NOT NULL,
    "status" "ConSubValuationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_sub_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "con_variations_instructionId_key" ON "con_variations"("instructionId");

-- CreateIndex
CREATE INDEX "con_variations_organizationId_idx" ON "con_variations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_variations_projectId_ref_key" ON "con_variations"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "con_valuations_reversesId_key" ON "con_valuations"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "con_valuations_saleId_key" ON "con_valuations"("saleId");

-- CreateIndex
CREATE INDEX "con_valuations_organizationId_idx" ON "con_valuations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_valuations_projectId_number_key" ON "con_valuations"("projectId", "number");

-- CreateIndex
CREATE INDEX "con_valuation_lines_organizationId_idx" ON "con_valuation_lines"("organizationId");

-- CreateIndex
CREATE INDEX "con_valuation_lines_valuationId_idx" ON "con_valuation_lines"("valuationId");

-- CreateIndex
CREATE INDEX "con_valuation_receipts_organizationId_idx" ON "con_valuation_receipts"("organizationId");

-- CreateIndex
CREATE INDEX "con_valuation_receipts_valuationId_idx" ON "con_valuation_receipts"("valuationId");

-- CreateIndex
CREATE INDEX "con_retention_ledger_organizationId_idx" ON "con_retention_ledger"("organizationId");

-- CreateIndex
CREATE INDEX "con_retention_ledger_projectId_idx" ON "con_retention_ledger"("projectId");

-- CreateIndex
CREATE INDEX "con_subcontracts_organizationId_idx" ON "con_subcontracts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_subcontracts_projectId_ref_key" ON "con_subcontracts"("projectId", "ref");

-- CreateIndex
CREATE INDEX "con_sub_valuations_organizationId_idx" ON "con_sub_valuations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_sub_valuations_subcontractId_number_key" ON "con_sub_valuations"("subcontractId", "number");

-- AddForeignKey
ALTER TABLE "con_variations" ADD CONSTRAINT "con_variations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_variations" ADD CONSTRAINT "con_variations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuations" ADD CONSTRAINT "con_valuations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuations" ADD CONSTRAINT "con_valuations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuations" ADD CONSTRAINT "con_valuations_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "con_valuations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuation_lines" ADD CONSTRAINT "con_valuation_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuation_lines" ADD CONSTRAINT "con_valuation_lines_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "con_valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuation_lines" ADD CONSTRAINT "con_valuation_lines_bqItemId_fkey" FOREIGN KEY ("bqItemId") REFERENCES "con_bq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuation_lines" ADD CONSTRAINT "con_valuation_lines_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "con_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuation_receipts" ADD CONSTRAINT "con_valuation_receipts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_valuation_receipts" ADD CONSTRAINT "con_valuation_receipts_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "con_valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_retention_ledger" ADD CONSTRAINT "con_retention_ledger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_retention_ledger" ADD CONSTRAINT "con_retention_ledger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_retention_ledger" ADD CONSTRAINT "con_retention_ledger_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "con_valuations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_subcontracts" ADD CONSTRAINT "con_subcontracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_subcontracts" ADD CONSTRAINT "con_subcontracts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_subcontracts" ADD CONSTRAINT "con_subcontracts_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "con_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_sub_valuations" ADD CONSTRAINT "con_sub_valuations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_sub_valuations" ADD CONSTRAINT "con_sub_valuations_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "con_subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

