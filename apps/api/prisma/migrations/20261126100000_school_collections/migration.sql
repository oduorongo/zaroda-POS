-- School supplier: chasing unpaid invoices. When the school promised to pay, whether it disputes the invoice (and why), who is
-- following it up, and notes. Additive only.
ALTER TABLE "supplier_invoices" ADD COLUMN "expectedPaymentDate" DATE,
ADD COLUMN "disputed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "disputeNote" TEXT,
ADD COLUMN "followUpNote" TEXT,
ADD COLUMN "responsibleId" TEXT,
ADD COLUMN "followUpUpdatedAt" TIMESTAMP(3);
