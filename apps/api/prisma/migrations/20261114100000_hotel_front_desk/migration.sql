-- Hotel front desk: physical rooms, room assignments, guest folios, front-desk bookings. Additive: new tables and columns,
-- two new payment methods, and four marketplace-only booking columns loosened to optional (existing rows keep their values).

-- CreateEnum
CREATE TYPE "RoomBookingSource" AS ENUM ('MARKETPLACE', 'FRONT_DESK', 'PHONE');

-- CreateEnum
CREATE TYPE "HotelRoomStatus" AS ENUM ('VACANT_CLEAN', 'VACANT_DIRTY', 'OCCUPIED', 'OUT_OF_ORDER');

-- CreateEnum
CREATE TYPE "FolioEntryType" AS ENUM ('ROOM_NIGHT', 'CHARGE', 'PAYMENT', 'REFUND', 'ADJUSTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'ROOM_CHARGE';
ALTER TYPE "PaymentMethod" ADD VALUE 'MPESA_RECEIPT';

-- AlterTable
ALTER TABLE "hotel_room_types" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "room_bookings" ADD COLUMN     "balanceLeftReason" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "earlyCheckInBy" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "rateOverriddenBy" TEXT,
ADD COLUMN     "settlementSaleId" TEXT,
ADD COLUMN     "source" "RoomBookingSource" NOT NULL DEFAULT 'MARKETPLACE',
ALTER COLUMN "hotelSlug" DROP NOT NULL,
ALTER COLUMN "paymentPhone" DROP NOT NULL,
ALTER COLUMN "paymentDeadline" DROP NOT NULL,
ALTER COLUMN "guestTokenHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT,
    "status" "HotelRoomStatus" NOT NULL DEFAULT 'VACANT_CLEAN',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_assignments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toAt" TIMESTAMP(3),
    "movedBy" TEXT,
    "reason" TEXT,

    CONSTRAINT "hotel_room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_folios" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "nightsPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_folio_entries" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "type" "FolioEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "nightDate" DATE,
    "method" "PaymentMethod",
    "reference" TEXT,
    "saleId" TEXT,
    "shiftId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_folio_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_rooms_organizationId_idx" ON "hotel_rooms"("organizationId");

-- CreateIndex
CREATE INDEX "hotel_rooms_roomTypeId_idx" ON "hotel_rooms"("roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rooms_branchId_number_key" ON "hotel_rooms"("branchId", "number");

-- CreateIndex
CREATE INDEX "hotel_room_assignments_bookingId_idx" ON "hotel_room_assignments"("bookingId");

-- CreateIndex
CREATE INDEX "hotel_room_assignments_roomId_idx" ON "hotel_room_assignments"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_folios_bookingId_key" ON "hotel_folios"("bookingId");

-- CreateIndex
CREATE INDEX "hotel_folios_organizationId_idx" ON "hotel_folios"("organizationId");

-- CreateIndex
CREATE INDEX "hotel_folio_entries_folioId_idx" ON "hotel_folio_entries"("folioId");

-- CreateIndex
CREATE INDEX "hotel_folio_entries_saleId_idx" ON "hotel_folio_entries"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_types_variantId_key" ON "hotel_room_types"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "room_bookings_settlementSaleId_key" ON "room_bookings"("settlementSaleId");

-- AddForeignKey
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_settlementSaleId_fkey" FOREIGN KEY ("settlementSaleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_assignments" ADD CONSTRAINT "hotel_room_assignments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "room_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_assignments" ADD CONSTRAINT "hotel_room_assignments_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_folios" ADD CONSTRAINT "hotel_folios_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_folios" ADD CONSTRAINT "hotel_folios_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "room_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_folio_entries" ADD CONSTRAINT "hotel_folio_entries_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "hotel_folios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_folio_entries" ADD CONSTRAINT "hotel_folio_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

