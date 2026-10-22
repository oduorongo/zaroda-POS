-- Supplier credit notes: money a supplier takes off a bill (damaged goods, a wrong price). Additive only.

-- AlterTable
ALTER TABLE "supplier_bills" ADD COLUMN     "creditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_bill_credits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_bill_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_bill_credits_billId_idx" ON "supplier_bill_credits"("billId");

-- AddForeignKey
ALTER TABLE "supplier_bill_credits" ADD CONSTRAINT "supplier_bill_credits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_credits" ADD CONSTRAINT "supplier_bill_credits_billId_fkey" FOREIGN KEY ("billId") REFERENCES "supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

