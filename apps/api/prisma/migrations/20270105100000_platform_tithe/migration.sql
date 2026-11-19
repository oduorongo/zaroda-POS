-- ZARODA's own books: the share of profit after tax set aside as tithe (percent).
ALTER TABLE "platform_ledger_settings" ADD COLUMN IF NOT EXISTS "titheRate" DECIMAL(5,2) NOT NULL DEFAULT 20;
