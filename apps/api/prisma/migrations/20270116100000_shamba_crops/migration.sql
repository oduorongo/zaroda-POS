-- CreateEnum
CREATE TYPE "FarmCropStatus" AS ENUM ('PLANNED', 'GROWING', 'HARVESTING', 'CLOSED');

-- CreateEnum
CREATE TYPE "FarmCropActivityKind" AS ENUM ('LAND_PREP', 'PLANTING', 'WEEDING', 'TOP_DRESSING', 'SPRAYING', 'IRRIGATION', 'SCOUTING', 'OTHER');

-- CreateTable
CREATE TABLE "farm_crop_seasons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "crop" TEXT NOT NULL,
    "variety" TEXT,
    "acres" DECIMAL(14,3) NOT NULL,
    "plantedOn" DATE,
    "expectedHarvest" DATE,
    "status" "FarmCropStatus" NOT NULL DEFAULT 'PLANNED',
    "seedSupplier" TEXT,
    "seedCertNo" TEXT,
    "notes" TEXT,
    "closedOn" DATE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_crop_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_crop_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "FarmCropActivityKind" NOT NULL,
    "product" TEXT,
    "rate" TEXT,
    "inputVariantId" TEXT,
    "quantity" DECIMAL(14,3),
    "stockBranchId" TEXT,
    "inputCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "workers" INTEGER,
    "labourCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "preHarvestDays" INTEGER,
    "safeHarvestFrom" DATE,
    "doneBy" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_crop_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_harvests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "kgPerUnit" DECIMAL(14,3) NOT NULL,
    "kg" DECIMAL(14,3) NOT NULL,
    "grade" TEXT,
    "stockVariantId" TEXT,
    "stockBranchId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_harvests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "farm_crop_seasons_organizationId_status_idx" ON "farm_crop_seasons"("organizationId", "status");

-- CreateIndex
CREATE INDEX "farm_crop_seasons_organizationId_unitId_idx" ON "farm_crop_seasons"("organizationId", "unitId");

-- CreateIndex
CREATE INDEX "farm_crop_activities_organizationId_seasonId_idx" ON "farm_crop_activities"("organizationId", "seasonId");

-- CreateIndex
CREATE INDEX "farm_harvests_organizationId_seasonId_idx" ON "farm_harvests"("organizationId", "seasonId");

