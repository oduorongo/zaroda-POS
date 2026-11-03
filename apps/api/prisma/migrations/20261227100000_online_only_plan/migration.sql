-- Free "Online Shop only" plan: a shop that sells in-store on another POS. No tills; ZARODA earns the 3% shopper fee.
INSERT INTO "plans" ("id", "tier", "name", "priceKes", "billingPeriodDays", "billingCycle", "maxDevices", "maxBranches", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'ONLINE_ONLY', 'Online Shop only', 0, 30, 'MONTHLY', 0, 1, true, now(), now())
ON CONFLICT ("tier") DO NOTHING;
