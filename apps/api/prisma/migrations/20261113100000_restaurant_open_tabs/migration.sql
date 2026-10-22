-- Restaurant open tabs: a running bill per table, paid in one or several sales. Additive only.
-- A table can have only one OPEN tab. Prisma cannot express a partial unique index, so it is written here by hand.
-- (prisma migrate diff will list it as something to drop; leave it in place.)

-- CreateEnum
CREATE TYPE "RestaurantTabStatus" AS ENUM ('OPEN', 'CLOSED', 'VOID');

-- CreateEnum
CREATE TYPE "RestaurantTabLineStatus" AS ENUM ('ORDERED', 'PAID', 'VOIDED');

-- AlterTable
ALTER TABLE "kitchen_stations" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "kitchen_ticket_lines" ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "kitchen_tickets" ADD COLUMN     "tabId" TEXT,
ALTER COLUMN "saleId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "restaurant_tables" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "restaurant_tabs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "RestaurantTabStatus" NOT NULL DEFAULT 'OPEN',
    "openedBy" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_tab_lines" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "stationId" TEXT NOT NULL,
    "courseNumber" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "status" "RestaurantTabLineStatus" NOT NULL DEFAULT 'ORDERED',
    "voidReason" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "addedById" TEXT NOT NULL,
    "kitchenTicketId" TEXT,
    "kitchenTicketLineId" TEXT,
    "claimClientId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_tab_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_tab_sales" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_tab_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reserveLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_tabs_organizationId_status_idx" ON "restaurant_tabs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "restaurant_tabs_tableId_idx" ON "restaurant_tabs"("tableId");

-- CreateIndex
CREATE INDEX "restaurant_tab_lines_tabId_idx" ON "restaurant_tab_lines"("tabId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tab_sales_saleId_key" ON "restaurant_tab_sales"("saleId");

-- CreateIndex
CREATE INDEX "restaurant_tab_sales_tabId_idx" ON "restaurant_tab_sales"("tabId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_settings_branchId_key" ON "restaurant_settings"("branchId");

-- CreateIndex
CREATE INDEX "restaurant_settings_organizationId_idx" ON "restaurant_settings"("organizationId");

-- CreateIndex
CREATE INDEX "kitchen_tickets_tabId_idx" ON "kitchen_tickets"("tabId");

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "restaurant_tabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tabs" ADD CONSTRAINT "restaurant_tabs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tabs" ADD CONSTRAINT "restaurant_tabs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tabs" ADD CONSTRAINT "restaurant_tabs_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tab_lines" ADD CONSTRAINT "restaurant_tab_lines_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "restaurant_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tab_lines" ADD CONSTRAINT "restaurant_tab_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tab_lines" ADD CONSTRAINT "restaurant_tab_lines_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tab_sales" ADD CONSTRAINT "restaurant_tab_sales_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "restaurant_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tab_sales" ADD CONSTRAINT "restaurant_tab_sales_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_settings" ADD CONSTRAINT "restaurant_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_settings" ADD CONSTRAINT "restaurant_settings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One OPEN tab per table
CREATE UNIQUE INDEX "restaurant_tabs_one_open_per_table" ON "restaurant_tabs"("tableId") WHERE "status" = 'OPEN';
