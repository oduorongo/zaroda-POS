-- Sales team training businesses: sample-data accounts per business type, shared by the team.
ALTER TABLE "organizations" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "sales_team_training_accounts" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "industryType" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_team_training_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_team_training_accounts_organizationId_key" ON "sales_team_training_accounts"("organizationId");
CREATE UNIQUE INDEX "sales_team_training_accounts_teamId_industryType_key" ON "sales_team_training_accounts"("teamId", "industryType");

ALTER TABLE "sales_team_training_accounts" ADD CONSTRAINT "sales_team_training_accounts_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "sales_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_team_training_accounts" ADD CONSTRAINT "sales_team_training_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
