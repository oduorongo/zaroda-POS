-- AlterTable
ALTER TABLE "rental_tenants" ADD COLUMN "phoneNormalized" TEXT;

-- CreateIndex
CREATE INDEX "rental_tenants_phoneNormalized_idx" ON "rental_tenants"("phoneNormalized");

-- Fill it in for tenants already on file: digits only, then 2547XXXXXXXX (same rule as the app's normalizeKenyanPhone).
-- Numbers that are not Kenyan mobile numbers are left empty.
UPDATE "rental_tenants" t
SET "phoneNormalized" = CASE
  WHEN d.digits ~ '^254[17][0-9]{8}$' THEN d.digits
  WHEN d.digits ~ '^0[17][0-9]{8}$' THEN '254' || substr(d.digits, 2)
  WHEN d.digits ~ '^[17][0-9]{8}$' THEN '254' || d.digits
  ELSE NULL
END
FROM (SELECT "id", regexp_replace("phone", '[^0-9]', '', 'g') AS digits FROM "rental_tenants" WHERE "phone" IS NOT NULL) d
WHERE d."id" = t."id";
