-- Construction: journal entries carry the project they belong to (profit and loss per project).

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE INDEX "journal_entries_organizationId_projectId_idx" ON "journal_entries"("organizationId", "projectId");
