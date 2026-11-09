-- The school supplier plan is KES 12,000 a year; "(per term)" made it read as 12,000 each term.
UPDATE "plans" SET "name" = 'School Supplier', "updatedAt" = CURRENT_TIMESTAMP WHERE "tier" = 'SEASONAL' AND "name" = 'School Supplier (per term)';
