-- Claimable VAT on purchases: the supplier's eTIMS invoice number (and, on expenses, their KRA PIN), or a link to the invoice KRA holds.
-- supplier_bills.updatedAt lets the books notice a changed bill. Existing rows: nothing set, so their VAT stays a cost until completed.

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "etimsInvoiceId" TEXT,
ADD COLUMN     "kraInvoiceNo" TEXT,
ADD COLUMN     "supplierName" TEXT,
ADD COLUMN     "supplierPin" TEXT;

-- AlterTable
ALTER TABLE "supplier_bills" ADD COLUMN     "etimsInvoiceId" TEXT,
ADD COLUMN     "kraInvoiceNo" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "expenses_etimsInvoiceId_key" ON "expenses"("etimsInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_etimsInvoiceId_key" ON "supplier_bills"("etimsInvoiceId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_etimsInvoiceId_fkey" FOREIGN KEY ("etimsInvoiceId") REFERENCES "etims_purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_etimsInvoiceId_fkey" FOREIGN KEY ("etimsInvoiceId") REFERENCES "etims_purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

