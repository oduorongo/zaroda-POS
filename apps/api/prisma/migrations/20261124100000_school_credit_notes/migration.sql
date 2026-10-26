-- School supplier: credit notes. A credit to a school against an invoice (goods returned, a short delivery, a price correction)
-- lowers what the school owes; the invoice records how much has been credited. Additive only.

-- CreateEnum
CREATE TYPE "SchoolCreditReason" AS ENUM ('RETURNED', 'DAMAGED', 'SHORT_DELIVERY', 'PRICE_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN "creditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_credit_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "creditNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "reason" "SchoolCreditReason" NOT NULL,
    "note" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "branchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_note_lines" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "quantityRestocked" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_creditNumber_key" ON "supplier_credit_notes"("creditNumber");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_organizationId_issueDate_idx" ON "supplier_credit_notes"("organizationId", "issueDate");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_schoolId_idx" ON "supplier_credit_notes"("schoolId");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_invoiceId_idx" ON "supplier_credit_notes"("invoiceId");

-- CreateIndex
CREATE INDEX "supplier_credit_note_lines_creditNoteId_idx" ON "supplier_credit_note_lines"("creditNoteId");

-- CreateIndex
CREATE INDEX "supplier_credit_note_lines_invoiceLineId_idx" ON "supplier_credit_note_lines"("invoiceLineId");

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_note_lines" ADD CONSTRAINT "supplier_credit_note_lines_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "supplier_credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_note_lines" ADD CONSTRAINT "supplier_credit_note_lines_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "supplier_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
