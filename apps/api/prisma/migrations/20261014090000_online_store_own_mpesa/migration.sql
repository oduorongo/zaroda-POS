-- A business can now collect online payments through its OWN M-Pesa (Safaricom Daraja:
-- Paybill or Till) instead of Tuma. Additive only: every existing shop stays on Tuma.
ALTER TABLE "online_stores"
  ADD COLUMN IF NOT EXISTS "paymentGateway" TEXT NOT NULL DEFAULT 'TUMA',
  ADD COLUMN IF NOT EXISTS "mpesaAccountType" TEXT,
  ADD COLUMN IF NOT EXISTS "mpesaShortcode" TEXT,
  ADD COLUMN IF NOT EXISTS "mpesaTillNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "mpesaConsumerKeyEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "mpesaConsumerSecretEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "mpesaPasskeyEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "mpesaEnvironment" TEXT NOT NULL DEFAULT 'production';
