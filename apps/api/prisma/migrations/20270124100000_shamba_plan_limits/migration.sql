-- Zaroda Shamba plan limits (2026-11-27). Farms already over a new limit keep everything they have; only adding more is stopped.
UPDATE "farm_plans" SET "limits" = '{"head":5,"birds":200,"acres":2,"users":2}'::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'FARM_KIENYEJI';
UPDATE "farm_plans" SET "limits" = '{"head":20,"birds":1000,"acres":5,"users":5}'::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'FARM_MKULIMA';
UPDATE "farm_plans" SET "limits" = '{"head":100,"birds":3000,"acres":10,"users":8}'::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'FARM_FARMER';
UPDATE "farm_plans" SET "limits" = '{"head":300,"birds":6000,"acres":20,"users":20}'::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'FARM_COMMERCIAL';
