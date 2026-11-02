-- In-app messages between people in a construction company (with RLS in rls.sql).

-- CreateTable
CREATE TABLE "con_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "senderOrgUserId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "projectId" TEXT,
    "threadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_message_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_message_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "con_messages_organizationId_threadId_idx" ON "con_messages"("organizationId", "threadId");

-- CreateIndex
CREATE INDEX "con_messages_organizationId_senderOrgUserId_createdAt_idx" ON "con_messages"("organizationId", "senderOrgUserId", "createdAt");

-- CreateIndex
CREATE INDEX "con_message_recipients_organizationId_orgUserId_readAt_idx" ON "con_message_recipients"("organizationId", "orgUserId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "con_message_recipients_messageId_orgUserId_key" ON "con_message_recipients"("messageId", "orgUserId");

-- AddForeignKey
ALTER TABLE "con_message_recipients" ADD CONSTRAINT "con_message_recipients_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "con_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

