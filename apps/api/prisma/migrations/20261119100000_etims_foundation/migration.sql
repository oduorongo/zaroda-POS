-- KRA eTIMS (OSCU) foundation: a business's eTIMS switch, one device per branch with its encrypted key, and KRA's code lists.
-- Additive only. The code-list tables hold KRA data (the same for every business) so they carry no tenant.

-- CreateEnum
CREATE TYPE "EtimsEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "EtimsDeviceStatus" AS ENUM ('NOT_CONNECTED', 'ACTIVE', 'FAILED');

-- CreateTable
CREATE TABLE "etims_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" "EtimsEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "tin" TEXT,
    "taxpayerName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etims_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "bhfId" TEXT NOT NULL,
    "dvcSrlNo" TEXT NOT NULL,
    "status" "EtimsDeviceStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "cmcKeyEnc" TEXT,
    "dvcId" TEXT,
    "sdcId" TEXT,
    "mrcNo" TEXT,
    "bhfNm" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etims_codes" (
    "environment" "EtimsEnvironment" NOT NULL,
    "cdCls" TEXT NOT NULL,
    "cdClsNm" TEXT NOT NULL,
    "cd" TEXT NOT NULL,
    "cdNm" TEXT NOT NULL,
    "cdDesc" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "userDfnCd1" TEXT,
    "useYn" TEXT NOT NULL DEFAULT 'Y',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_codes_pkey" PRIMARY KEY ("environment","cdCls","cd")
);

-- CreateTable
CREATE TABLE "etims_item_classes" (
    "environment" "EtimsEnvironment" NOT NULL,
    "itemClsCd" TEXT NOT NULL,
    "itemClsNm" TEXT NOT NULL,
    "itemClsLvl" INTEGER,
    "taxTyCd" TEXT,
    "useYn" TEXT NOT NULL DEFAULT 'Y',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_item_classes_pkey" PRIMARY KEY ("environment","itemClsCd")
);

-- CreateTable
CREATE TABLE "etims_sync_state" (
    "environment" "EtimsEnvironment" NOT NULL,
    "kind" TEXT NOT NULL,
    "lastReqDt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_sync_state_pkey" PRIMARY KEY ("environment","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "etims_settings_organizationId_key" ON "etims_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_devices_branchId_key" ON "etims_devices"("branchId");

-- CreateIndex
CREATE INDEX "etims_devices_organizationId_idx" ON "etims_devices"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "etims_devices_organizationId_bhfId_key" ON "etims_devices"("organizationId", "bhfId");

-- CreateIndex
CREATE INDEX "etims_codes_environment_cdCls_idx" ON "etims_codes"("environment", "cdCls");

-- CreateIndex
CREATE INDEX "etims_item_classes_environment_itemClsNm_idx" ON "etims_item_classes"("environment", "itemClsNm");

-- AddForeignKey
ALTER TABLE "etims_settings" ADD CONSTRAINT "etims_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_devices" ADD CONSTRAINT "etims_devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_devices" ADD CONSTRAINT "etims_devices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

