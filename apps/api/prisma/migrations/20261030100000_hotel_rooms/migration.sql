-- CreateEnum
CREATE TYPE "RoomBookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "hotel_room_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amenities" TEXT,
    "pricePerNight" DECIMAL(12,2) NOT NULL,
    "maxGuests" INTEGER NOT NULL DEFAULT 2,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "depositPercent" INTEGER NOT NULL DEFAULT 30,
    "isListed" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_photos" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_room_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_bookings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "status" "RoomBookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guests" INTEGER NOT NULL,
    "rooms" INTEGER NOT NULL DEFAULT 1,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "notes" TEXT,
    "hotelName" TEXT NOT NULL,
    "hotelSlug" TEXT NOT NULL,
    "roomTypeName" TEXT NOT NULL,
    "pricePerNight" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "depositAmount" INTEGER NOT NULL,
    "commissionRate" DECIMAL(5,4) NOT NULL,
    "commissionAmount" DECIMAL(12,2),
    "paymentPhone" TEXT NOT NULL,
    "paymentDeadline" TIMESTAMP(3) NOT NULL,
    "tumaMerchantRequestId" TEXT,
    "paymentAttemptedAt" TIMESTAMP(3),
    "mpesaReceiptNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "lastPaymentError" TEXT,
    "guestTokenHash" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_room_types_organizationId_idx" ON "hotel_room_types"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_photos_storageKey_key" ON "hotel_room_photos"("storageKey");

-- CreateIndex
CREATE INDEX "hotel_room_photos_roomTypeId_idx" ON "hotel_room_photos"("roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "room_bookings_bookingNumber_key" ON "room_bookings"("bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "room_bookings_mpesaReceiptNumber_key" ON "room_bookings"("mpesaReceiptNumber");

-- CreateIndex
CREATE INDEX "room_bookings_organizationId_status_idx" ON "room_bookings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "room_bookings_roomTypeId_checkIn_checkOut_idx" ON "room_bookings"("roomTypeId", "checkIn", "checkOut");

-- AddForeignKey
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_photos" ADD CONSTRAINT "hotel_room_photos_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
