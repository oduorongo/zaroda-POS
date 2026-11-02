-- eTIMS phase 4: purchases from suppliers' KRA invoices, supplier KRA PIN, stock movements
-- CreateEnum
CREATE TYPE "EtimsPurchaseStatus" AS ENUM ('WAITING', 'ACCEPTED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EtimsDocKind" ADD VALUE 'PURCHASE';
ALTER TYPE "EtimsDocKind" ADD VALUE 'STOCK_MOVE';

-- AlterTable
ALTER TABLE "etims_devices" ADD COLUMN     "pchsSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purchasesSyncedAt" TEXT;

-- AlterTable
ALTER TABLE "etims_documents" ADD COLUMN     "purchaseInvoiceId" TEXT,
ADD COLUMN     "receiptId" TEXT,
ALTER COLUMN "saleId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "kraPin" TEXT;

-- CreateTable
CREATE TABLE "etims_purchase_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "spplrTin" TEXT NOT NULL,
    "spplrNm" TEXT,
    "spplrBhfId" TEXT NOT NULL,
    "spplrInvcNo" INTEGER NOT NULL,
    "rcptTyCd" TEXT NOT NULL,
    "pmtTyCd" TEXT,
    "salesDt" TEXT,
    "totAmt" DECIMAL(14,2) NOT NULL,
    "body" JSONB NOT NULL,
    "status" "EtimsPurchaseStatus" NOT NULL DEFAULT 'WAITING',
    "goodsReceiptId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etims_purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etims_supplier_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spplrTin" TEXT NOT NULL,
    "spplrItemCd" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etims_supplier_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etims_purchase_invoices_organizationId_status_createdAt_idx" ON "etims_purchase_invoices"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "etims_purchase_invoices_organizationId_branchId_spplrTin_sp_key" ON "etims_purchase_invoices"("organizationId", "branchId", "spplrTin", "spplrBhfId", "spplrInvcNo", "rcptTyCd");

-- CreateIndex
CREATE INDEX "etims_supplier_items_variantId_idx" ON "etims_supplier_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_supplier_items_organizationId_spplrTin_spplrItemCd_key" ON "etims_supplier_items"("organizationId", "spplrTin", "spplrItemCd");

-- AddForeignKey
ALTER TABLE "etims_purchase_invoices" ADD CONSTRAINT "etims_purchase_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_supplier_items" ADD CONSTRAINT "etims_supplier_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_supplier_items" ADD CONSTRAINT "etims_supplier_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

