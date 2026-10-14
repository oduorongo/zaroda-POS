-- CreateTable
CREATE TABLE "rental_tenant_otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_tenant_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_tenant_otps_email_createdAt_idx" ON "rental_tenant_otps"("email", "createdAt");

