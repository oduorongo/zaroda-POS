-- Construction C3: site diaries, photos, site instructions, workers, muster roll, toolbox talks, PPE, permits to work, incidents. Additive only.

-- CreateEnum
CREATE TYPE "ConDiaryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ConInstructionStatus" AS ENUM ('OPEN', 'ACTIONED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConMusterStatus" AS ENUM ('PRESENT', 'HALF', 'ABSENT');

-- CreateEnum
CREATE TYPE "ConWorkPermitType" AS ENUM ('HEIGHT', 'HOT_WORK', 'EXCAVATION', 'CONFINED', 'ELECTRICAL');

-- CreateEnum
CREATE TYPE "ConWorkPermitStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConIncidentSeverity" AS ENUM ('NEAR_MISS', 'MINOR', 'LOST_TIME', 'FATAL');

-- CreateTable
CREATE TABLE "con_site_diaries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weather" TEXT,
    "worksDone" TEXT,
    "delays" TEXT,
    "visitors" TEXT,
    "plantOnSite" TEXT,
    "labourCount" INTEGER,
    "status" "ConDiaryStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_site_diaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_site_photos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "diaryId" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "caption" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "takenAt" TIMESTAMP(3) NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_site_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_site_instructions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partyId" TEXT,
    "issuedByName" TEXT,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ConInstructionStatus" NOT NULL DEFAULT 'OPEN',
    "variationId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_site_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_workers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "idNo" TEXT,
    "phone" TEXT,
    "trade" TEXT NOT NULL,
    "ncaCardNo" TEXT,
    "ncaExpiresAt" DATE,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "isSupervisor" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_muster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "ConMusterStatus" NOT NULL,
    "hours" DECIMAL(4,1),
    "markedBy" TEXT,
    "clientRef" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_muster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_toolbox_talks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "topic" TEXT NOT NULL,
    "notes" TEXT,
    "attendeeIds" JSONB NOT NULL DEFAULT '[]',
    "heldBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_toolbox_talks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_ppe_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" DATE NOT NULL,
    "issuedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_ppe_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_permits_to_work" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "ConWorkPermitType" NOT NULL,
    "location" TEXT NOT NULL,
    "precautions" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "ConWorkPermitStatus" NOT NULL DEFAULT 'OPEN',
    "issuedBy" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_permits_to_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "severity" "ConIncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "workerId" TEXT,
    "reportDueAt" TIMESTAMP(3),
    "reportedToDoshs" BOOLEAN NOT NULL DEFAULT false,
    "reportedAt" TIMESTAMP(3),
    "doshsRef" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "con_site_diaries_organizationId_idx" ON "con_site_diaries"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_site_diaries_projectId_date_key" ON "con_site_diaries"("projectId", "date");

-- CreateIndex
CREATE INDEX "con_site_photos_organizationId_idx" ON "con_site_photos"("organizationId");

-- CreateIndex
CREATE INDEX "con_site_photos_projectId_takenAt_idx" ON "con_site_photos"("projectId", "takenAt");

-- CreateIndex
CREATE INDEX "con_site_instructions_organizationId_idx" ON "con_site_instructions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_site_instructions_projectId_number_key" ON "con_site_instructions"("projectId", "number");

-- CreateIndex
CREATE INDEX "con_workers_organizationId_projectId_idx" ON "con_workers"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "con_workers_organizationId_idNo_key" ON "con_workers"("organizationId", "idNo");

-- CreateIndex
CREATE INDEX "con_muster_organizationId_idx" ON "con_muster"("organizationId");

-- CreateIndex
CREATE INDEX "con_muster_projectId_date_idx" ON "con_muster"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "con_muster_projectId_workerId_date_key" ON "con_muster"("projectId", "workerId", "date");

-- CreateIndex
CREATE INDEX "con_toolbox_talks_organizationId_idx" ON "con_toolbox_talks"("organizationId");

-- CreateIndex
CREATE INDEX "con_toolbox_talks_projectId_idx" ON "con_toolbox_talks"("projectId");

-- CreateIndex
CREATE INDEX "con_ppe_issues_organizationId_idx" ON "con_ppe_issues"("organizationId");

-- CreateIndex
CREATE INDEX "con_ppe_issues_projectId_idx" ON "con_ppe_issues"("projectId");

-- CreateIndex
CREATE INDEX "con_permits_to_work_organizationId_idx" ON "con_permits_to_work"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_permits_to_work_projectId_number_key" ON "con_permits_to_work"("projectId", "number");

-- CreateIndex
CREATE INDEX "con_incidents_organizationId_idx" ON "con_incidents"("organizationId");

-- CreateIndex
CREATE INDEX "con_incidents_projectId_occurredAt_idx" ON "con_incidents"("projectId", "occurredAt");

-- AddForeignKey
ALTER TABLE "con_site_diaries" ADD CONSTRAINT "con_site_diaries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_diaries" ADD CONSTRAINT "con_site_diaries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_photos" ADD CONSTRAINT "con_site_photos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_photos" ADD CONSTRAINT "con_site_photos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_photos" ADD CONSTRAINT "con_site_photos_diaryId_fkey" FOREIGN KEY ("diaryId") REFERENCES "con_site_diaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_instructions" ADD CONSTRAINT "con_site_instructions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_instructions" ADD CONSTRAINT "con_site_instructions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_site_instructions" ADD CONSTRAINT "con_site_instructions_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "con_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_workers" ADD CONSTRAINT "con_workers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_workers" ADD CONSTRAINT "con_workers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_muster" ADD CONSTRAINT "con_muster_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_muster" ADD CONSTRAINT "con_muster_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_muster" ADD CONSTRAINT "con_muster_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "con_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_toolbox_talks" ADD CONSTRAINT "con_toolbox_talks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_toolbox_talks" ADD CONSTRAINT "con_toolbox_talks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_ppe_issues" ADD CONSTRAINT "con_ppe_issues_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_ppe_issues" ADD CONSTRAINT "con_ppe_issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_ppe_issues" ADD CONSTRAINT "con_ppe_issues_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "con_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_permits_to_work" ADD CONSTRAINT "con_permits_to_work_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_permits_to_work" ADD CONSTRAINT "con_permits_to_work_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_incidents" ADD CONSTRAINT "con_incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_incidents" ADD CONSTRAINT "con_incidents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_incidents" ADD CONSTRAINT "con_incidents_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "con_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

