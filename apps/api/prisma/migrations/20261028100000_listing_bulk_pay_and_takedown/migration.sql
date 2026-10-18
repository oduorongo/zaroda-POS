-- AlterTable
ALTER TABLE "rental_listings" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedReason" TEXT;

-- AlterTable
ALTER TABLE "rental_listing_payments" ADD COLUMN     "listingIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Payments made before this change covered exactly one advert.
UPDATE "rental_listing_payments" SET "listingIds" = ARRAY["listingId"] WHERE cardinality("listingIds") = 0;
