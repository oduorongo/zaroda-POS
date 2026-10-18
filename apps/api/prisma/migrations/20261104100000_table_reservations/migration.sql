-- CreateEnum
CREATE TYPE "TableReservationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'SEATED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "online_stores" ADD COLUMN     "reservationsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "table_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT,
    "reservationNumber" TEXT NOT NULL,
    "status" "TableReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "notes" TEXT,
    "restaurantNote" TEXT,
    "shopName" TEXT NOT NULL,
    "shopSlug" TEXT NOT NULL,
    "guestTokenHash" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "table_reservations_reservationNumber_key" ON "table_reservations"("reservationNumber");

-- CreateIndex
CREATE INDEX "table_reservations_organizationId_date_idx" ON "table_reservations"("organizationId", "date");

-- CreateIndex
CREATE INDEX "table_reservations_organizationId_status_idx" ON "table_reservations"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
