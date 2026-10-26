-- Tender adverts: a school can post through its supplier's ordering portal; the account made for it remembers which school it stands for. Additive only.
ALTER TABLE "tender_buyers" ADD COLUMN     "supplierOrgId" TEXT,
ADD COLUMN     "supplierSchoolId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tender_buyers_supplierSchoolId_key" ON "tender_buyers"("supplierSchoolId");
