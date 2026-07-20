-- CreateEnum
CREATE TYPE "SalonAppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "salon_resources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salon_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salon_appointments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "customerId" TEXT,
    "serviceName" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "SalonAppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salon_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salon_resources_organizationId_idx" ON "salon_resources"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "salon_resources_branchId_name_key" ON "salon_resources"("branchId", "name");

-- CreateIndex
CREATE INDEX "salon_appointments_resourceId_startTime_idx" ON "salon_appointments"("resourceId", "startTime");

-- CreateIndex
CREATE INDEX "salon_appointments_organizationId_idx" ON "salon_appointments"("organizationId");

-- AddForeignKey
ALTER TABLE "salon_resources" ADD CONSTRAINT "salon_resources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_resources" ADD CONSTRAINT "salon_resources_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "salon_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
