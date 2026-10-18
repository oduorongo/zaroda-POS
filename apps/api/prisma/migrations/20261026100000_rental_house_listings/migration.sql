-- CreateTable
CREATE TABLE "rental_listings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "monthlyRent" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_listing_photos" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_listing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_listings_unitId_key" ON "rental_listings"("unitId");

-- CreateIndex
CREATE INDEX "rental_listings_organizationId_idx" ON "rental_listings"("organizationId");

-- CreateIndex
CREATE INDEX "rental_listings_isActive_confirmedAt_idx" ON "rental_listings"("isActive", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rental_listing_photos_storageKey_key" ON "rental_listing_photos"("storageKey");

-- CreateIndex
CREATE INDEX "rental_listing_photos_listingId_idx" ON "rental_listing_photos"("listingId");

-- AddForeignKey
ALTER TABLE "rental_listings" ADD CONSTRAINT "rental_listings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_listings" ADD CONSTRAINT "rental_listings_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_listing_photos" ADD CONSTRAINT "rental_listing_photos_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "rental_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
