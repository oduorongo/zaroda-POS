-- AlterTable
ALTER TABLE "online_stores" ADD COLUMN     "tableOrderingBlockedAt" TIMESTAMP(3),
ADD COLUMN     "tableOrderingBlockedReason" TEXT;
