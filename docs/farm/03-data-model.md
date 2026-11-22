# 03 — Zaroda Shamba: Data Model

All tables are prefixed `farm_`, every row carries `organizationId`, every table has FORCE ROW LEVEL SECURITY with the
standard `tenant_isolation` policy (rls.sql). Money is `Decimal(14,2)` KES; quantities are `Decimal(14,3)`.

## F1 Foundation
- `farm_plans` (code, name, monthlyPrice, annualPrice, maxHead, maxBirds, maxAcres, maxUsers, features[], active) — data, not code.
- `farm_subscriptions` (organizationId, planCode, status TRIAL/ACTIVE/GRACE/SUSPENDED, currentPeriodEnd, cycle).
- `farm_settings` (organizationId, farmName, county, subCounty, ward, mainProduce, units: ACRE/HECTARE, milkUnit: LITRE).
- `farm_units` (id, branchId, parentId, kind, name, code, acres, capacity, notes, active).
- `farm_enterprises` (id, kind, name, unitIds[], active).
- `farm_user_roles` (orgUserId, role, unitIds[] — empty = all).

## F2 Livestock
- Breeds are free text on animals and groups (`breed`), with common Kenyan breeds offered as suggestions in the screens
  (Friesian, Ayrshire, Jersey, Sahiwal, Boran, Galla, Toggenburg, Saanen, Dorper, Large White, Kuroiler, Kenbro, Isa
  Brown...) - crosses and local names are common, so no `farm_breeds` table. `breedId` below is `breed` (text).
- `farm_group_counts` (groupId, date, change, reason, note, amount) — every head-count change of a group; the count
  never goes below zero.
- `farm_due_tasks` (kind, title, animalId/groupId, programmeId, dueOn, doneOn, cancelledAt, remindedOn) — programme
  doses, drying off and expected births; reminders go 7, 3 and 1 days before, on the day, and once when overdue.
- `farm_animals` (id, enterpriseId, groupId, unitId, tag, name, species, breedId, sex, birthDate, birthEstimated,
  damId, sireId, sireCode, source, boughtOn, boughtPrice, status, statusDate, photoUrl).
- `farm_groups` (id, enterpriseId, unitId, species, breedId, name, placedOn, headCount, purpose).
- `farm_group_counts` (groupId, date, change, reason PLACED/BORN/DIED/SOLD/MOVED/CULLED/ADJUSTED, note) — head count history.
- `farm_drugs` (productVariantId, milkWithdrawalDays, meatWithdrawalDays, eggWithdrawalDays) — extends stock items.
- `farm_health_events` (animalId|groupId, date, kind SICK/TREATED/VACCINATED/DEWORMED/DIPPED/CHECKED, diagnosis,
  drugId, dose, quantityFromStock, byOrgUserId, vetName, cost, withdrawalMilkUntil, withdrawalMeatUntil).
- `farm_programmes` (species, name, intervalDays, firstAgeDays, drug) + `farm_due_tasks` (what is due, for whom, when, done).
- `farm_breeding_events` (animalId, date, kind HEAT/SERVED/AI/PD_POSITIVE/PD_NEGATIVE/DRIED_OFF/BIRTH/ABORTION,
  sireId|sireCode, inseminator, expectedBirth).
- `farm_weights` (animalId|groupId, date, kg, bodyCondition).

## F3 Production
- `farm_milk_records` (animalId|groupId, date, session AM/NOON/PM, litres, withheld boolean, use SOLD/CALVES/HOME/DISCARDED).
- `farm_egg_records` (groupId, date, goodEggs, cracked, small, feedKg, deaths).
- `farm_produce_records` (enterpriseId, date, product, quantity, unit).

## F4 Crops
- `farm_crop_seasons` (unitId, enterpriseId, crop, variety, acres, plantedOn, expectedHarvest, status).
- `farm_crop_activities` (seasonId, date, kind, inputVariantId, quantity, rate, labourCost, preHarvestDays, safeHarvestFrom).
- `farm_harvests` (seasonId, date, quantity, unit, grade, toStockVariantId).

## F5 Feed
- `farm_rations` (name, species, stage, outputVariantId, batchKg) + `farm_ration_items` (variantId, kg).
- `farm_feed_batches` (rationId, date, kgProduced, cost, costPerKg, approvedBy) — posts stock out (ingredients) and in (feed).
- `farm_feedings` (groupId|animalId, date, variantId, kg).

## F6 Labour and sales
- `farm_workers`, `farm_muster`, `farm_wage_runs` (reusing Build's payroll pattern and B2C client).
- Sales use POS `Sale`; `farm_sale_tags` links a sale line to an enterprise and blocks produce under withdrawal.
