-- Every Zaroda School subscription payment, so it is posted to ZARODA's own books.
CREATE TABLE "school_subscription_receipts" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "school_subscription_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "school_subscription_receipts_paidAt_idx" ON "school_subscription_receipts"("paidAt");
