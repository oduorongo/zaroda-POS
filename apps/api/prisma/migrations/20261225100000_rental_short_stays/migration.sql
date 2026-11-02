-- CreateEnum
CREATE TYPE "RentalStayStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "RentalStaySource" AS ENUM ('DIRECT', 'AIRBNB', 'BOOKING_COM', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalCleaningStatus" AS ENUM ('PENDING', 'DONE');

-- AlterTable
ALTER TABLE "rental_settings" ADD COLUMN     "stayTexts" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rental_unit_owners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_unit_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stay_units" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "ownerId" TEXT,
    "nightlyRate" DECIMAL(12,2) NOT NULL,
    "weekendRate" DECIMAL(12,2),
    "minNights" INTEGER NOT NULL DEFAULT 1,
    "maxGuests" INTEGER NOT NULL DEFAULT 2,
    "cleaningFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "checkInTime" TEXT NOT NULL DEFAULT '14:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '10:00',
    "directions" TEXT,
    "doorCodeEncrypted" TEXT,
    "cleanerName" TEXT,
    "cleanerPhone" TEXT,
    "calendarToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_stay_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stays" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" "RentalStaySource" NOT NULL DEFAULT 'DIRECT',
    "externalRef" TEXT,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT,
    "guestEmail" TEXT,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "accommodation" DECIMAL(12,2) NOT NULL,
    "cleaningFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "channelFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "RentalStayStatus" NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stay_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" DATE NOT NULL,
    "note" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_stay_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stay_blocks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "feedId" TEXT,
    "source" TEXT NOT NULL,
    "uid" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_stay_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stay_feeds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "source" "RentalStaySource" NOT NULL,
    "url" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_stay_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stay_cleanings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "stayId" TEXT,
    "dueDate" DATE NOT NULL,
    "status" "RentalCleaningStatus" NOT NULL DEFAULT 'PENDING',
    "cleanerName" TEXT,
    "cleanerPhone" TEXT,
    "notes" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_stay_cleanings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_stay_notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_stay_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_unit_owners_organizationId_idx" ON "rental_unit_owners"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_unit_owners_organizationId_name_key" ON "rental_unit_owners"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_units_unitId_key" ON "rental_stay_units"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_units_calendarToken_key" ON "rental_stay_units"("calendarToken");

-- CreateIndex
CREATE INDEX "rental_stay_units_organizationId_idx" ON "rental_stay_units"("organizationId");

-- CreateIndex
CREATE INDEX "rental_stays_organizationId_checkIn_idx" ON "rental_stays"("organizationId", "checkIn");

-- CreateIndex
CREATE INDEX "rental_stays_unitId_checkIn_idx" ON "rental_stays"("unitId", "checkIn");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stays_organizationId_code_key" ON "rental_stays"("organizationId", "code");

-- CreateIndex
CREATE INDEX "rental_stay_payments_organizationId_idx" ON "rental_stay_payments"("organizationId");

-- CreateIndex
CREATE INDEX "rental_stay_payments_stayId_idx" ON "rental_stay_payments"("stayId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_payments_organizationId_reference_key" ON "rental_stay_payments"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_payments_organizationId_receiptNumber_key" ON "rental_stay_payments"("organizationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "rental_stay_blocks_organizationId_idx" ON "rental_stay_blocks"("organizationId");

-- CreateIndex
CREATE INDEX "rental_stay_blocks_unitId_startDate_idx" ON "rental_stay_blocks"("unitId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_blocks_feedId_uid_key" ON "rental_stay_blocks"("feedId", "uid");

-- CreateIndex
CREATE INDEX "rental_stay_feeds_organizationId_idx" ON "rental_stay_feeds"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_feeds_unitId_url_key" ON "rental_stay_feeds"("unitId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_cleanings_stayId_key" ON "rental_stay_cleanings"("stayId");

-- CreateIndex
CREATE INDEX "rental_stay_cleanings_organizationId_dueDate_idx" ON "rental_stay_cleanings"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "rental_stay_cleanings_unitId_idx" ON "rental_stay_cleanings"("unitId");

-- CreateIndex
CREATE INDEX "rental_stay_notifications_organizationId_idx" ON "rental_stay_notifications"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_stay_notifications_stayId_kind_key" ON "rental_stay_notifications"("stayId", "kind");

-- AddForeignKey
ALTER TABLE "rental_stay_units" ADD CONSTRAINT "rental_stay_units_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_units" ADD CONSTRAINT "rental_stay_units_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "rental_unit_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stays" ADD CONSTRAINT "rental_stays_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_stay_units"("unitId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_payments" ADD CONSTRAINT "rental_stay_payments_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "rental_stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_blocks" ADD CONSTRAINT "rental_stay_blocks_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_stay_units"("unitId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_blocks" ADD CONSTRAINT "rental_stay_blocks_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "rental_stay_feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_feeds" ADD CONSTRAINT "rental_stay_feeds_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_stay_units"("unitId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_cleanings" ADD CONSTRAINT "rental_stay_cleanings_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_stay_units"("unitId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_cleanings" ADD CONSTRAINT "rental_stay_cleanings_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "rental_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_stay_notifications" ADD CONSTRAINT "rental_stay_notifications_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "rental_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

