-- DropIndex
DROP INDEX "rental_listings_isActive_confirmedAt_idx";

-- AlterTable
ALTER TABLE "rental_listings" ADD COLUMN     "paidUntil" TIMESTAMP(3);

-- Adverts that already exist were free: keep them up until their current 30-day expiry, then they need a payment.
UPDATE "rental_listings" SET "paidUntil" = "confirmedAt" + interval '30 days';

-- CreateTable
CREATE TABLE "rental_listing_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tumaMerchantRequestId" TEXT,
    "paymentReference" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "rental_listing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_listing_payments_organizationId_idx" ON "rental_listing_payments"("organizationId");

-- CreateIndex
CREATE INDEX "rental_listing_payments_listingId_idx" ON "rental_listing_payments"("listingId");

-- CreateIndex
CREATE INDEX "rental_listings_isActive_paidUntil_idx" ON "rental_listings"("isActive", "paidUntil");

-- AddForeignKey
ALTER TABLE "rental_listing_payments" ADD CONSTRAINT "rental_listing_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_listing_payments" ADD CONSTRAINT "rental_listing_payments_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "rental_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

