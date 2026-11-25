-- CreateEnum
CREATE TYPE "FarmFeedBatchStatus" AS ENUM ('PENDING', 'APPROVED', 'REVERSED');

-- CreateTable
CREATE TABLE "farm_rations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT,
    "stage" TEXT,
    "outputVariantId" TEXT NOT NULL,
    "batchKg" DECIMAL(14,3) NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_rations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_ration_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "farm_ration_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_feed_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "rationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kgProduced" DECIMAL(14,3) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costPerKg" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outputVariantId" TEXT NOT NULL,
    "stockBranchId" TEXT,
    "status" "FarmFeedBatchStatus" NOT NULL DEFAULT 'PENDING',
    "mixedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_feed_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_feed_batch_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "farm_feed_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_feedings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "animalId" TEXT,
    "groupId" TEXT,
    "date" DATE NOT NULL,
    "variantId" TEXT NOT NULL,
    "kg" DECIMAL(14,3) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stockBranchId" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_feedings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "farm_rations_organizationId_idx" ON "farm_rations"("organizationId");

-- CreateIndex
CREATE INDEX "farm_ration_items_organizationId_rationId_idx" ON "farm_ration_items"("organizationId", "rationId");

-- CreateIndex
CREATE INDEX "farm_feed_batches_organizationId_date_idx" ON "farm_feed_batches"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "farm_feed_batches_organizationId_batchNo_key" ON "farm_feed_batches"("organizationId", "batchNo");

-- CreateIndex
CREATE INDEX "farm_feed_batch_items_organizationId_batchId_idx" ON "farm_feed_batch_items"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "farm_feedings_organizationId_date_idx" ON "farm_feedings"("organizationId", "date");

-- CreateIndex
CREATE INDEX "farm_feedings_organizationId_groupId_idx" ON "farm_feedings"("organizationId", "groupId");

-- CreateIndex
CREATE INDEX "farm_feedings_organizationId_animalId_idx" ON "farm_feedings"("organizationId", "animalId");

