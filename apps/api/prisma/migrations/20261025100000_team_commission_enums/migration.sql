-- New earning kinds and statuses for the team commission spec. Split from the next migration because Postgres
-- will not let a value added to an enum be used in the same transaction.
ALTER TYPE "SalesEarningKind" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_SHARE';
ALTER TYPE "SalesEarningKind" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
ALTER TYPE "SalesEarningStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "SalesEarningStatus" ADD VALUE IF NOT EXISTS 'PAYABLE';
ALTER TYPE "SalesEarningStatus" ADD VALUE IF NOT EXISTS 'VOID';
