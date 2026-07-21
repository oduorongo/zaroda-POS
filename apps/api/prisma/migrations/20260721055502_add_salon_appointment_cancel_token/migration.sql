-- Add cancelToken as nullable first (existing rows can't satisfy a
-- NOT NULL default in one step), backfill every existing row with a
-- real random UUID, then tighten to NOT NULL + UNIQUE. gen_random_uuid()
-- is the same function Postgres/pgcrypto already provides for every
-- other @default(uuid()) column in this schema (e.g. every model's own
-- `id`), so no new extension is required here.
ALTER TABLE "salon_appointments" ADD COLUMN "cancelToken" TEXT;

UPDATE "salon_appointments" SET "cancelToken" = gen_random_uuid()::text WHERE "cancelToken" IS NULL;

ALTER TABLE "salon_appointments" ALTER COLUMN "cancelToken" SET NOT NULL;

CREATE UNIQUE INDEX "salon_appointments_cancelToken_key" ON "salon_appointments"("cancelToken");
