-- Tuma identifies a payment by its merchant request id (what /payment/status
-- is asked about), not the payment id the first version stored.
ALTER TABLE "online_orders" RENAME COLUMN "tumaPaymentId" TO "tumaMerchantRequestId";

-- Commission invoices: online payment through ZARODA's Tuma account, plus
-- the markers that make automatic emailing/reminders idempotent.
ALTER TABLE "commission_invoices"
  ADD COLUMN "amountDue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tumaMerchantRequestId" TEXT,
  ADD COLUMN "payPhone" TEXT,
  ADD COLUMN "payAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "lastPaymentError" TEXT,
  ADD COLUMN "emailedAt" TIMESTAMP(3),
  ADD COLUMN "reminderStage" INTEGER NOT NULL DEFAULT 0;
