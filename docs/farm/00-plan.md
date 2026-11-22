# 00 — Zaroda Shamba: Plan

Zaroda Shamba is farm management for Kenyan farms, small and large: livestock, crops, animal feed production, animal
husbandry and selling what the farm produces. It is a **business type plugin** on the POS (`Organization.industryType =
'FARM'`), built the same way as Zaroda Build (docs/construction/00-plan.md): same NestJS API, same back office app,
served at its own address `SHAMBA_DOMAIN` (shamba.zarodasolutions.app).

## What Shamba reuses (never forked)
| Need | Reuses |
|---|---|
| Sign-in, staff, roles | `User` + `OrgUser`, JWT, RLS tenant isolation |
| Farm sites | `Branch` — each farm (or far-apart farm block) is a branch, so stock, transfers and stock-takes work per farm |
| Feed ingredients, drugs, seed, fertiliser, produce | `Product` / `ProductVariant` + `InventoryItem` / `InventoryTransaction` |
| Buying inputs | `Supplier`, `PurchaseOrder`, `GoodsReceipt`, `SupplierBill` |
| Selling milk, eggs, animals, produce | POS `Sale` (cash, M-Pesa, credit to customers), customers, receipts, eTIMS |
| Casual wages | the M-Pesa B2C client and statutory calculator Build uses (`con_payroll` pattern) |
| Files (vet certificates, permits) | `ObjectStorageService`, private files as in Build |
| Alerts | BullMQ worker + SMS/email (vaccinations due, withdrawal ends, calving due) |
| Books | the general ledger (`src/accounting`) |
| Audit | `AuditLogService` (who, what, when, before/after) |

## What is new (all tables `farm_`, every row carries `organizationId`)
1. **Farm layout** — blocks, fields, paddocks, pens, poultry houses, ponds (`farm_units`), with size in acres.
2. **Enterprises** — dairy, beef, poultry layers/broilers, pigs, goats, sheep, rabbits, fish, bees, maize, beans,
   vegetables, fodder... A cost or income is tagged to one, so profit per enterprise can be reported.
3. **Livestock** — individual animals (tag, breed, sex, birth, dam/sire, status) and groups/flocks counted by head.
4. **Husbandry** — health events, treatments with **withdrawal periods** (milk/meat must not be sold before they end),
   vaccinations and reminders, breeding (heat, AI/service, pregnancy check, expected calving), births, weights, deaths.
5. **Production** — milk per cow per milking, eggs per flock per day, other produce.
6. **Crops** — seasons per field: planting, inputs applied, spraying with pre-harvest interval, harvest and yield.
7. **Feed production** — rations (recipes) from stock ingredients, mixing batches into finished feed stock, feeding
   records per group, cost per kg.
8. **Farm plans** — `farm_plans` (data, editable), limits by livestock head, birds, acres and users, gated server-side.

## Phases (prompts/farm/)
| Phase | Scope |
|---|---|
| F1 Foundation | FARM business type, `farm_plans` + subscription, `@FarmFeature()` gating, SHAMBA_DOMAIN routing, Shamba landing/pricing/login/signup, farm layout (`farm_units`), enterprises, farm roles, settings, demo tenant |
| F2 Livestock | animals and groups, health and treatments (withdrawal), vaccinations + reminders, breeding and births, weights, deaths, sales of animals |
| F3 Production | milk records, egg records, other produce; sale of produce through the POS; yields and trends |
| F4 Crops | seasons, planting, inputs, spraying (PHI), harvests, yield per acre |
| F5 Feed production | rations, mixing batches (stock in/out), feeding records, feed cost per kg and per animal |
| F6 Labour and sales | casual workers, muster roll, M-Pesa wages; buyers (co-ops, hotels), credit sales, deliveries |
| F7 Reports | profit per enterprise, cost per litre/egg/kg, herd and crop reports, PDF/Excel, ledger postings |

Every phase ends with: migration, rls.sql rules, seed data for the demo farm "Uriri Dairy & Poultry Farm", tests and a
CHANGELOG entry. Database changes run BEFORE merging.
