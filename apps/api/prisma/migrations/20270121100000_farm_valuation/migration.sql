-- Zaroda Shamba: animal and flock valuation (suggested selling prices).

-- AlterTable
ALTER TABLE "farm_settings" ADD COLUMN "valuationMarginRate" DECIMAL(5,4) NOT NULL DEFAULT 0.20,
ADD COLUMN "valuationProductionDays" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "farm_valuation_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "species" "FarmSpecies" NOT NULL,
    "birthValueKes" DECIMAL(14,2) NOT NULL,
    "pricePerKgKes" DECIMAL(14,2) NOT NULL,
    "primeAgeMonths" INTEGER,
    "ageDropRate" DECIMAL(5,4) NOT NULL DEFAULT 0.15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_valuation_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farm_valuation_rates_organizationId_species_key" ON "farm_valuation_rates"("organizationId", "species");
