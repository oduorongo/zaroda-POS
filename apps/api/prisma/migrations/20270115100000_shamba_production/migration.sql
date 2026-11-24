-- CreateEnum
CREATE TYPE "FarmMilkSession" AS ENUM ('AM', 'NOON', 'PM');

-- CreateEnum
CREATE TYPE "FarmMilkUse" AS ENUM ('SOLD', 'CALVES', 'HOME', 'DISCARDED');

-- CreateTable
CREATE TABLE "farm_produce_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "milkVariantId" TEXT,
    "eggVariantId" TEXT,
    "eggsPerUnit" INTEGER NOT NULL DEFAULT 30,
    "branchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_produce_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_milk_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "animalId" TEXT,
    "groupId" TEXT,
    "date" DATE NOT NULL,
    "session" "FarmMilkSession" NOT NULL,
    "litres" DECIMAL(14,3) NOT NULL,
    "withheld" BOOLEAN NOT NULL DEFAULT false,
    "use" "FarmMilkUse" NOT NULL,
    "toStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stockVariantId" TEXT,
    "stockBranchId" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_milk_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_egg_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "birds" INTEGER NOT NULL,
    "goodEggs" INTEGER NOT NULL,
    "cracked" INTEGER NOT NULL DEFAULT 0,
    "small" INTEGER NOT NULL DEFAULT 0,
    "feedKg" DECIMAL(14,3),
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "withheld" BOOLEAN NOT NULL DEFAULT false,
    "toStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stockVariantId" TEXT,
    "stockBranchId" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_egg_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_produce_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "date" DATE NOT NULL,
    "product" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "note" TEXT,
    "stockVariantId" TEXT,
    "stockBranchId" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_produce_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farm_produce_settings_organizationId_key" ON "farm_produce_settings"("organizationId");

-- CreateIndex
CREATE INDEX "farm_milk_records_organizationId_date_idx" ON "farm_milk_records"("organizationId", "date");

-- CreateIndex
CREATE INDEX "farm_milk_records_organizationId_animalId_idx" ON "farm_milk_records"("organizationId", "animalId");

-- CreateIndex
CREATE INDEX "farm_egg_records_organizationId_date_idx" ON "farm_egg_records"("organizationId", "date");

-- CreateIndex
CREATE INDEX "farm_egg_records_organizationId_groupId_date_idx" ON "farm_egg_records"("organizationId", "groupId", "date");

-- CreateIndex
CREATE INDEX "farm_produce_records_organizationId_date_idx" ON "farm_produce_records"("organizationId", "date");

