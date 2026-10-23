-- eTIMS sales: the switch for sending sales (and when it was turned on), running invoice and stock numbers per device, and one
-- document per sale or credit note on its way to KRA, remembering each step. Additive only.

-- CreateEnum
CREATE TYPE "EtimsDocKind" AS ENUM ('SALE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "EtimsDocStatus" AS ENUM ('PENDING', 'SENT', 'REJECTED', 'MANUAL');

-- AlterTable
ALTER TABLE "etims_devices" ADD COLUMN     "invcSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sarSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "etims_settings" ADD COLUMN     "salesStartAt" TIMESTAMP(3),
ADD COLUMN     "sendSales" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "etims_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "EtimsDocKind" NOT NULL,
    "saleId" TEXT NOT NULL,
    "refundId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "status" "EtimsDocStatus" NOT NULL DEFAULT 'PENDING',
    "invcNo" INTEGER,
    "sarNo" INTEGER,
    "saleDone" BOOLEAN NOT NULL DEFAULT false,
    "stockDone" BOOLEAN NOT NULL DEFAULT false,
    "masterDone" BOOLEAN NOT NULL DEFAULT false,
    "curRcptNo" INTEGER,
    "totRcptNo" INTEGER,
    "intrlData" TEXT,
    "rcptSign" TEXT,
    "sdcDateTime" TEXT,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etims_documents_organizationId_status_createdAt_idx" ON "etims_documents"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "etims_documents_saleId_idx" ON "etims_documents"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_documents_organizationId_sourceKey_key" ON "etims_documents"("organizationId", "sourceKey");

-- AddForeignKey
ALTER TABLE "etims_documents" ADD CONSTRAINT "etims_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

