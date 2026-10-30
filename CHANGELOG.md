# Changelog

## Construction C1: foundation (2026-10-30)

- New business type `CONSTRUCTION`, served at `CONSTRUCTION_DOMAIN` with its own landing, pricing, login and signup (host-based `middleware.ts`; `?product=construction` on localhost).
- Construction roles (17, company/project/external) with approval limits per role; `ConstructionGuard` + `@ConRoles()`, `@ConFeature()`, `ConProjectGuard`; owners act as Director.
- Compliance vault: NCA registrations per works class, documents with private file storage, green/amber/red expiry badges, alerts at 60/30/7 days and on expiry (in-app, email, SMS), dashboard "Compliance health" card.
- NCA category caps and tax/statutory rates (VAT, WHT, NCA levy (off), retention, SHIF, Housing Levy, NSSF) as editable settings with effective dates; NCA cap check for later tender/project phases.
- Plans as data (`con_plans`: Mjengo (KES 1,500, 1 site, no extra projects, optional KES 3,000 setup), Fundi, Contractor, Pro, Enterprise), `con_subscriptions`, `con_coupons` (PILOT50), 14-day Contractor trial on signup, M-Pesa payment via Tuma extends the paid period, 7-day grace then read-only, user limit enforced when adding staff, upgrade prompts (HTTP 402).
- Super-admin "Construction" screen: edit plans and coupons, MRR and tenants per plan, extend trials, apply coupons, record payments, run expiry alerts.
- Every create/update/delete is audit-logged with before/after.
- Migration `20261211100000_construction_foundation` (+ `rls.sql` policies), demo seed `prisma/seed-construction.ts` ("Uriri Builders Ltd", NCA5 Building, NCA6 Roads, Contractor plan), tests `scripts/e2e-construction.js` (93 checks).
