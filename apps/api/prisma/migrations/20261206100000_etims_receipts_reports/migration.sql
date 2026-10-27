-- eTIMS: KRA-format receipts and the X / Z / PLU reports. Z reports keep the day's summary; each document belongs to one Z report; copies printed are counted. Additive only.
-- AlterTable
ALTER TABLE "etims_documents" ADD COLUMN     "zReportId" TEXT;

-- CreateTable
CREATE TABLE "etims_z_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "totals" JSONB NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "etims_z_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etims_receipt_prints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "etims_receipt_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etims_documents_branchId_zReportId_idx" ON "etims_documents"("branchId", "zReportId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_z_reports_branchId_number_key" ON "etims_z_reports"("branchId", "number");

-- CreateIndex
CREATE INDEX "etims_z_reports_organizationId_branchId_createdAt_idx" ON "etims_z_reports"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "etims_receipt_prints_organizationId_branchId_createdAt_idx" ON "etims_receipt_prints"("organizationId", "branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "etims_z_reports" ADD CONSTRAINT "etims_z_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_receipt_prints" ADD CONSTRAINT "etims_receipt_prints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
