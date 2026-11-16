-- Sales teams earn on Zaroda School: schools a member brought in, and the subscriptions they pay.
CREATE TABLE "sales_schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentRef" TEXT NOT NULL,
    "signedUpAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_schools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_school_payments" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_school_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_schools_teamId_idx" ON "sales_schools"("teamId");
CREATE INDEX "sales_schools_agentId_idx" ON "sales_schools"("agentId");
CREATE INDEX "sales_school_payments_schoolId_idx" ON "sales_school_payments"("schoolId");

ALTER TABLE "sales_schools" ADD CONSTRAINT "sales_schools_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "sales_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_schools" ADD CONSTRAINT "sales_schools_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "sales_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_school_payments" ADD CONSTRAINT "sales_school_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "sales_schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
