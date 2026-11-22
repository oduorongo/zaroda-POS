-- Zaroda Shamba F2: livestock and husbandry - animals, groups and head counts, drugs with withdrawal days, health events,
-- vaccination programmes and due tasks, breeding, weights. docs/farm.

-- CreateEnum
CREATE TYPE "FarmSpecies" AS ENUM ('CATTLE', 'GOAT', 'SHEEP', 'PIG', 'CHICKEN', 'DUCK', 'TURKEY', 'RABBIT', 'FISH', 'BEE', 'OTHER');

-- CreateEnum
CREATE TYPE "FarmSex" AS ENUM ('FEMALE', 'MALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FarmAnimalStatus" AS ENUM ('ACTIVE', 'SOLD', 'DIED', 'SLAUGHTERED', 'CULLED', 'LOST');

-- CreateEnum
CREATE TYPE "FarmAnimalSource" AS ENUM ('BORN', 'BOUGHT');

-- CreateEnum
CREATE TYPE "FarmCountReason" AS ENUM ('PLACED', 'BORN', 'BOUGHT', 'DIED', 'SOLD', 'SLAUGHTERED', 'CULLED', 'MOVED_OUT', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "FarmHealthKind" AS ENUM ('SICK', 'TREATED', 'VACCINATED', 'DEWORMED', 'DIPPED', 'CHECKED');

-- CreateEnum
CREATE TYPE "FarmBreedingKind" AS ENUM ('HEAT', 'SERVED', 'AI', 'PD_POSITIVE', 'PD_NEGATIVE', 'DRIED_OFF', 'BIRTH', 'ABORTION');

-- CreateTable
CREATE TABLE "farm_animals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "groupId" TEXT,
    "unitId" TEXT,
    "tag" TEXT NOT NULL,
    "name" TEXT,
    "species" "FarmSpecies" NOT NULL,
    "breed" TEXT,
    "sex" "FarmSex" NOT NULL,
    "birthDate" DATE,
    "birthEstimated" BOOLEAN NOT NULL DEFAULT false,
    "damId" TEXT,
    "sireId" TEXT,
    "sireCode" TEXT,
    "source" "FarmAnimalSource" NOT NULL DEFAULT 'BOUGHT',
    "boughtOn" DATE,
    "boughtPrice" DECIMAL(14,2),
    "status" "FarmAnimalStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusDate" DATE,
    "statusNote" TEXT,
    "exitAmount" DECIMAL(14,2),
    "exitParty" TEXT,
    "permitNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_groups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "unitId" TEXT,
    "species" "FarmSpecies" NOT NULL,
    "breed" TEXT,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "placedOn" DATE NOT NULL,
    "headCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_group_counts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "change" INTEGER NOT NULL,
    "reason" "FarmCountReason" NOT NULL,
    "note" TEXT,
    "amount" DECIMAL(14,2),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_group_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_drugs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variantId" TEXT,
    "milkWithdrawalDays" INTEGER NOT NULL DEFAULT 0,
    "meatWithdrawalDays" INTEGER NOT NULL DEFAULT 0,
    "eggWithdrawalDays" INTEGER NOT NULL DEFAULT 0,
    "prescriptionOnly" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_drugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_health_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "animalId" TEXT,
    "groupId" TEXT,
    "date" DATE NOT NULL,
    "kind" "FarmHealthKind" NOT NULL,
    "diagnosis" TEXT,
    "drugId" TEXT,
    "dose" TEXT,
    "byOrgUserId" TEXT,
    "vetName" TEXT,
    "cost" DECIMAL(14,2),
    "notes" TEXT,
    "milkWithdrawalUntil" DATE,
    "meatWithdrawalUntil" DATE,
    "eggWithdrawalUntil" DATE,
    "programmeId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_programmes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "species" "FarmSpecies" NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FarmHealthKind" NOT NULL,
    "drugId" TEXT,
    "firstAgeDays" INTEGER,
    "intervalDays" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_due_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "animalId" TEXT,
    "groupId" TEXT,
    "programmeId" TEXT,
    "dueOn" DATE NOT NULL,
    "doneOn" DATE,
    "cancelledAt" TIMESTAMP(3),
    "remindedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_due_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_breeding_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "FarmBreedingKind" NOT NULL,
    "sireId" TEXT,
    "sireCode" TEXT,
    "inseminator" TEXT,
    "expectedBirth" DATE,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_breeding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_weights" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "animalId" TEXT,
    "groupId" TEXT,
    "date" DATE NOT NULL,
    "kg" DECIMAL(14,3) NOT NULL,
    "bodyCondition" DECIMAL(3,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_weights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "farm_animals_organizationId_status_idx" ON "farm_animals"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "farm_animals_organizationId_tag_key" ON "farm_animals"("organizationId", "tag");

-- CreateIndex
CREATE INDEX "farm_groups_organizationId_active_idx" ON "farm_groups"("organizationId", "active");

-- CreateIndex
CREATE INDEX "farm_group_counts_organizationId_groupId_date_idx" ON "farm_group_counts"("organizationId", "groupId", "date");

-- CreateIndex
CREATE INDEX "farm_drugs_organizationId_idx" ON "farm_drugs"("organizationId");

-- CreateIndex
CREATE INDEX "farm_health_events_organizationId_animalId_idx" ON "farm_health_events"("organizationId", "animalId");

-- CreateIndex
CREATE INDEX "farm_health_events_organizationId_groupId_idx" ON "farm_health_events"("organizationId", "groupId");

-- CreateIndex
CREATE INDEX "farm_programmes_organizationId_idx" ON "farm_programmes"("organizationId");

-- CreateIndex
CREATE INDEX "farm_due_tasks_organizationId_dueOn_idx" ON "farm_due_tasks"("organizationId", "dueOn");

-- CreateIndex
CREATE INDEX "farm_breeding_events_organizationId_animalId_idx" ON "farm_breeding_events"("organizationId", "animalId");

-- CreateIndex
CREATE INDEX "farm_weights_organizationId_animalId_idx" ON "farm_weights"("organizationId", "animalId");

