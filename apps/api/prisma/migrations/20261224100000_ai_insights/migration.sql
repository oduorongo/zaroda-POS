-- AI Business Analyser: weekly summaries and owners' questions (also counted for the plan limits). Additive only.
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT,
    "answer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "askedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_insights_organizationId_kind_createdAt_idx" ON "ai_insights"("organizationId", "kind", "createdAt");
