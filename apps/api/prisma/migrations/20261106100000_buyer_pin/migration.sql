-- Shoppers can sign in with a phone number and a PIN (works on every network), not only an email or text code.
ALTER TABLE "buyers" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "buyers" ADD COLUMN "pinFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "buyers" ADD COLUMN "pinLockedUntil" TIMESTAMP(3);
