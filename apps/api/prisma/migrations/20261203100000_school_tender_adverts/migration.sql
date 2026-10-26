-- Tender adverts: schools post what they want to buy, every school-supplier business sees it. Additive only.
-- CreateEnum
CREATE TYPE "TenderBuyerStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TenderAdvertStatus" AS ENUM ('OPEN', 'CANCELLED', 'REMOVED');

-- CreateEnum
CREATE TYPE "TenderNoticeState" AS ENUM ('SEEN', 'SAVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "tender_buyers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "county" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinFailCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "status" "TenderBuyerStatus" NOT NULL DEFAULT 'PENDING',
    "statusNote" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "tender_buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_adverts" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "documentsInfo" TEXT,
    "closingDate" DATE NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" "TenderAdvertStatus" NOT NULL DEFAULT 'OPEN',
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "tender_adverts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_tender_notices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "advertId" TEXT NOT NULL,
    "state" "TenderNoticeState" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "school_tender_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tender_buyers_phone_key" ON "tender_buyers"("phone");

-- CreateIndex
CREATE INDEX "tender_adverts_status_closingDate_idx" ON "tender_adverts"("status", "closingDate");

-- CreateIndex
CREATE INDEX "tender_adverts_buyerId_idx" ON "tender_adverts"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "school_tender_notices_organizationId_advertId_key" ON "school_tender_notices"("organizationId", "advertId");

-- CreateIndex
CREATE INDEX "school_tender_notices_organizationId_idx" ON "school_tender_notices"("organizationId");

-- AddForeignKey
ALTER TABLE "tender_adverts" ADD CONSTRAINT "tender_adverts_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "tender_buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_tender_notices" ADD CONSTRAINT "school_tender_notices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_tender_notices" ADD CONSTRAINT "school_tender_notices_advertId_fkey" FOREIGN KEY ("advertId") REFERENCES "tender_adverts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
