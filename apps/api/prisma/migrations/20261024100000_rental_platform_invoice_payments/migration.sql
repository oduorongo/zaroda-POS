-- AlterTable
ALTER TABLE "rental_platform_invoices"
  ADD COLUMN "tumaMerchantRequestId" TEXT,
  ADD COLUMN "payPhone" TEXT,
  ADD COLUMN "payAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "lastPaymentError" TEXT;
