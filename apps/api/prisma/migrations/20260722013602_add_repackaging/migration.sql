-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'REPACK';

-- CreateTable
CREATE TABLE "repackagings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromVariantId" TEXT NOT NULL,
    "fromQuantity" INTEGER NOT NULL,
    "toVariantId" TEXT NOT NULL,
    "toQuantity" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repackagings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repackagings_organizationId_idx" ON "repackagings"("organizationId");

-- CreateIndex
CREATE INDEX "repackagings_branchId_idx" ON "repackagings"("branchId");

-- AddForeignKey
ALTER TABLE "repackagings" ADD CONSTRAINT "repackagings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repackagings" ADD CONSTRAINT "repackagings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repackagings" ADD CONSTRAINT "repackagings_fromVariantId_fkey" FOREIGN KEY ("fromVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repackagings" ADD CONSTRAINT "repackagings_toVariantId_fkey" FOREIGN KEY ("toVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repackagings" ADD CONSTRAINT "repackagings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "org_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
