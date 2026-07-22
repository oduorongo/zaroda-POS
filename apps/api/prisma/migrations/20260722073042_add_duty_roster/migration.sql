-- CreateTable
CREATE TABLE "roster_shifts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_shifts_organizationId_idx" ON "roster_shifts"("organizationId");

-- CreateIndex
CREATE INDEX "roster_shifts_branchId_idx" ON "roster_shifts"("branchId");

-- CreateIndex
CREATE INDEX "roster_shifts_orgUserId_idx" ON "roster_shifts"("orgUserId");

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "org_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
