-- Money ZARODA earned in its other apps (School professional records wallet, Books, Sports, Events), for ZARODA's own books.
CREATE TABLE "app_income_receipts" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_income_receipts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "app_income_receipts_paidAt_idx" ON "app_income_receipts"("paidAt");
