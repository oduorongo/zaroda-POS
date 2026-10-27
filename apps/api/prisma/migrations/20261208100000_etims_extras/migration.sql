-- eTIMS: KRA notices, imported items to approve, and customers with a KRA PIN sent to KRA. Additive only.
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "etimsCustNo" TEXT,
ADD COLUMN     "etimsSentKey" TEXT;

-- AlterTable
ALTER TABLE "etims_settings" ADD COLUMN     "custSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "importsSyncedAt" TEXT,
ADD COLUMN     "noticesSyncedAt" TEXT;

-- CreateTable
CREATE TABLE "etims_notices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noticeNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "detailUrl" TEXT,
    "postedBy" TEXT,
    "postedAt" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "etims_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etims_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskCd" TEXT NOT NULL,
    "declDate" TEXT NOT NULL,
    "itemSeq" INTEGER NOT NULL,
    "declNo" TEXT,
    "hsCd" TEXT,
    "itemName" TEXT NOT NULL,
    "originCd" TEXT,
    "exportCd" TEXT,
    "pkg" DECIMAL(13,2),
    "pkgUnitCd" TEXT,
    "qty" DECIMAL(13,2),
    "qtyUnitCd" TEXT,
    "grossWeight" DECIMAL(13,2),
    "netWeight" DECIMAL(13,2),
    "supplierName" TEXT,
    "agentName" TEXT,
    "invoiceAmount" DECIMAL(18,2),
    "invoiceCurrency" TEXT,
    "invoiceRate" DECIMAL(18,2),
    "statusCd" TEXT NOT NULL DEFAULT '2',
    "variantId" TEXT,
    "remark" TEXT,
    "decidedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "etims_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etims_notices_organizationId_noticeNo_key" ON "etims_notices"("organizationId", "noticeNo");

-- CreateIndex
CREATE UNIQUE INDEX "etims_imports_organizationId_taskCd_declDate_itemSeq_key" ON "etims_imports"("organizationId", "taskCd", "declDate", "itemSeq");

-- AddForeignKey
ALTER TABLE "etims_notices" ADD CONSTRAINT "etims_notices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_imports" ADD CONSTRAINT "etims_imports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
