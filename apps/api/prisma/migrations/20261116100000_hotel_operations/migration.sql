-- Hotel operations: cancellation policy and settings, room taxes, rate cards, seasons and meal prices, the guest register,
-- night audits and a message log. Additive only: new tables, and new columns with defaults on room_bookings and hotel_folio_entries.

-- CreateEnum
CREATE TYPE "MealPlan" AS ENUM ('ROOM_ONLY', 'BED_BREAKFAST', 'HALF_BOARD', 'FULL_BOARD');

-- CreateEnum
CREATE TYPE "HotelNotificationKind" AS ENUM ('CONFIRMATION', 'REMINDER', 'THANK_YOU', 'CANCELLATION', 'AMENDMENT');

-- AlterTable
ALTER TABLE "hotel_folio_entries" ADD COLUMN     "taxBreakdown" JSONB;

-- AlterTable
ALTER TABLE "room_bookings" ADD COLUMN     "adults" INTEGER,
ADD COLUMN     "cancelFeeKept" DECIMAL(12,2),
ADD COLUMN     "children" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "guestId" TEXT,
ADD COLUMN     "mealPlan" "MealPlan" NOT NULL DEFAULT 'ROOM_ONLY',
ADD COLUMN     "priceBreakdown" JSONB,
ADD COLUMN     "smsOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "hotel_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cancelFreeDays" INTEGER NOT NULL DEFAULT 2,
    "cancelKeepPercent" INTEGER NOT NULL DEFAULT 0,
    "nightAuditHour" INTEGER NOT NULL DEFAULT 3,
    "noShowCutoffHour" INTEGER NOT NULL DEFAULT 18,
    "confirmationSms" BOOLEAN NOT NULL DEFAULT true,
    "reminderSms" BOOLEAN NOT NULL DEFAULT true,
    "thankYouSms" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_taxes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rate_cards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "weekendRate" DECIMAL(12,2),
    "weekendDays" INTEGER[] DEFAULT ARRAY[5, 6]::INTEGER[],
    "includedAdults" INTEGER NOT NULL DEFAULT 2,
    "freeChildren" INTEGER NOT NULL DEFAULT 0,
    "extraAdultRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraChildRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_seasons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "weekendRate" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_meal_prices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "plan" "MealPlan" NOT NULL,
    "adultPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "childPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_meal_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_guests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "idNumberEnc" TEXT,
    "idLast4" TEXT,
    "idHash" TEXT,
    "nationality" TEXT,
    "address" TEXT,
    "vehicleReg" TEXT,
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_night_audits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "auditDate" DATE NOT NULL,
    "ranBy" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_night_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" "HotelNotificationKind" NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_settings_organizationId_key" ON "hotel_settings"("organizationId");

-- CreateIndex
CREATE INDEX "hotel_taxes_organizationId_idx" ON "hotel_taxes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rate_cards_roomTypeId_key" ON "hotel_rate_cards"("roomTypeId");

-- CreateIndex
CREATE INDEX "hotel_rate_cards_organizationId_idx" ON "hotel_rate_cards"("organizationId");

-- CreateIndex
CREATE INDEX "hotel_seasons_organizationId_idx" ON "hotel_seasons"("organizationId");

-- CreateIndex
CREATE INDEX "hotel_seasons_roomTypeId_startDate_endDate_idx" ON "hotel_seasons"("roomTypeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "hotel_meal_prices_organizationId_idx" ON "hotel_meal_prices"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_meal_prices_roomTypeId_plan_key" ON "hotel_meal_prices"("roomTypeId", "plan");

-- CreateIndex
CREATE INDEX "hotel_guests_organizationId_phone_idx" ON "hotel_guests"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_guests_organizationId_idHash_key" ON "hotel_guests"("organizationId", "idHash");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_night_audits_organizationId_auditDate_key" ON "hotel_night_audits"("organizationId", "auditDate");

-- CreateIndex
CREATE INDEX "hotel_notifications_organizationId_idx" ON "hotel_notifications"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_notifications_bookingId_kind_key" ON "hotel_notifications"("bookingId", "kind");

-- CreateIndex
CREATE INDEX "room_bookings_guestId_idx" ON "room_bookings"("guestId");

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "hotel_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_settings" ADD CONSTRAINT "hotel_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_taxes" ADD CONSTRAINT "hotel_taxes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rate_cards" ADD CONSTRAINT "hotel_rate_cards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rate_cards" ADD CONSTRAINT "hotel_rate_cards_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_seasons" ADD CONSTRAINT "hotel_seasons_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_seasons" ADD CONSTRAINT "hotel_seasons_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_meal_prices" ADD CONSTRAINT "hotel_meal_prices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_meal_prices" ADD CONSTRAINT "hotel_meal_prices_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "hotel_room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_guests" ADD CONSTRAINT "hotel_guests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_night_audits" ADD CONSTRAINT "hotel_night_audits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_notifications" ADD CONSTRAINT "hotel_notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_notifications" ADD CONSTRAINT "hotel_notifications_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "room_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

