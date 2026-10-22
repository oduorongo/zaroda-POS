-- Catalog management: products can be archived (hidden, history kept), and a category name is unique per business ignoring
-- upper/lower case. Additive. Prisma cannot express a case-insensitive unique index, so it is written here by hand (a later
-- `prisma migrate diff` will list it as something to drop; leave it in place).

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- A business that already has two categories differing only by case ("Drinks" and "drinks") would make the index fail:
-- the later ones are renamed "Drinks (2)", "Drinks (3)". Nothing is deleted and no product moves.
UPDATE "categories" c
SET "name" = c."name" || ' (' || d.n || ')'
FROM (
  SELECT id, row_number() OVER (PARTITION BY "organizationId", lower("name") ORDER BY "createdAt", id) AS n
  FROM "categories"
) d
WHERE c.id = d.id AND d.n > 1;

-- One category per name (any case) per business
CREATE UNIQUE INDEX "categories_organizationId_lower_name_key" ON "categories" ("organizationId", lower("name"));
