-- CreateTable
CREATE TABLE "online_stores" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "addonActive" BOOLEAN NOT NULL DEFAULT false,
    "commissionRate" DECIMAL(5,4),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "displayName" TEXT,
    "description" TEXT,
    "contactPhone" TEXT,
    "fulfilmentBranchId" TEXT,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tumaEmail" TEXT,
    "tumaApiKeyEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_stores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "online_stores_organizationId_key" ON "online_stores"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "online_stores_slug_key" ON "online_stores"("slug");

-- CreateIndex
CREATE INDEX "online_stores_fulfilmentBranchId_idx" ON "online_stores"("fulfilmentBranchId");

-- AddForeignKey
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_fulfilmentBranchId_fkey" FOREIGN KEY ("fulfilmentBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

