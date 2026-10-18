-- AlterTable
ALTER TABLE "online_stores" ADD COLUMN     "hotelBlockedAt" TIMESTAMP(3),
ADD COLUMN     "hotelBlockedReason" TEXT;
