-- School supplier: withholding tax. Tax a school keeps back when it pays is recorded as a payment of a new kind that settles the
-- invoice, with the withholding certificate (number, and the day it arrived) kept on it. Additive only.
ALTER TYPE "SupplierPaymentMethod" ADD VALUE 'WITHHOLDING_TAX';

ALTER TABLE "supplier_payments" ADD COLUMN "whtCertificateNumber" TEXT,
ADD COLUMN "whtCertificateReceivedOn" DATE;
