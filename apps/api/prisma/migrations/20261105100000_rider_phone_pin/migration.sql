-- Riders can sign in with a phone number and a PIN, so an email address is no longer required.
ALTER TABLE "riders" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "riders" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "riders" ADD COLUMN "pinFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "riders" ADD COLUMN "pinLockedUntil" TIMESTAMP(3);
