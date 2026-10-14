-- Rental / property management, phase 1: properties, units, tenants and leases.

-- CreateEnum
CREATE TYPE "RentalUnitStatus" AS ENUM ('VACANT', 'OCCUPIED');

-- CreateEnum
CREATE TYPE "RentalLeaseStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "rental_properties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_units" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthlyRent" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "RentalUnitStatus" NOT NULL DEFAULT 'VACANT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_tenants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "idNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_leases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "endedAt" DATE,
    "monthlyRent" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDay" INTEGER NOT NULL DEFAULT 1,
    "status" "RentalLeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_properties_organizationId_idx" ON "rental_properties"("organizationId");
CREATE UNIQUE INDEX "rental_properties_organizationId_name_key" ON "rental_properties"("organizationId", "name");
CREATE INDEX "rental_units_organizationId_idx" ON "rental_units"("organizationId");
CREATE UNIQUE INDEX "rental_units_propertyId_label_key" ON "rental_units"("propertyId", "label");
CREATE INDEX "rental_tenants_organizationId_idx" ON "rental_tenants"("organizationId");
CREATE INDEX "rental_leases_organizationId_idx" ON "rental_leases"("organizationId");
CREATE INDEX "rental_leases_unitId_status_idx" ON "rental_leases"("unitId", "status");
CREATE INDEX "rental_leases_tenantId_idx" ON "rental_leases"("tenantId");

-- A unit can have only one ACTIVE lease at a time (Prisma cannot express a partial unique index).
CREATE UNIQUE INDEX "rental_leases_one_active_per_unit" ON "rental_leases"("unitId") WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_tenants" ADD CONSTRAINT "rental_tenants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_leases" ADD CONSTRAINT "rental_leases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rental_leases" ADD CONSTRAINT "rental_leases_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rental_leases" ADD CONSTRAINT "rental_leases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "rental_tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
