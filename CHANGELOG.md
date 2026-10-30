# Changelog

## Construction C2: tenders, projects, permits, BQ, programme (2026-10-30)

- Tender register (Preparing → Submitted → Won/Lost/Withdrawn) with the NCA category cap check: above the cap only a Director can go ahead, with a reason that is kept. Submitting warns about an expired KRA TCC, NCA licence, bid bond or closing date.
- A won tender becomes a project (client created from the procuring entity). Projects: code, client, works class, contract sum, form of contract, dates, defects period, retention, county, site location and GPS.
- Project status flow Planning → Active → Practical completion → Defects period → Closed. Going Active is blocked without an approved NCA project registration (a Director can make it a warning) and warns about county plans, building permit, NEMA, DOSHS, WIBA cover, the client and the BQ total; closing warns without an occupancy certificate.
- Parties (client, architect, QS, engineer, subcontractor), project team with project roles; a Site Supervisor needs a valid NCA accreditation card (warning within 30 days of expiry). Site staff see only their projects.
- Permit checklist per project with private files; permits and staff NCA cards join the 60/30/7-day expiry alerts.
- BQ import from Excel (.xlsx) or CSV with a preview, errors and warnings before anything is saved; manual edit of sections and items; totals against the contract sum with the difference shown.
- Milestones with percent complete and a Gantt bar view; programme progress weighted by duration. Active projects (not closed) count toward the plan limit; Mjengo asks to upgrade to Fundi.
- Migration `20261212100000_construction_projects_bq` (+ `rls.sql`), seed project "Uriri Day Secondary Classrooms" (30-line BQ, KES 10,713,000), `exceljs` added to the API, e2e now 167 checks.

## Construction C1: foundation (2026-10-30)

- New business type `CONSTRUCTION`, served at `CONSTRUCTION_DOMAIN` with its own landing, pricing, login and signup (host-based `middleware.ts`; `?product=construction` on localhost).
- Construction roles (17, company/project/external) with approval limits per role; `ConstructionGuard` + `@ConRoles()`, `@ConFeature()`, `ConProjectGuard`; owners act as Director.
- Compliance vault: NCA registrations per works class, documents with private file storage, green/amber/red expiry badges, alerts at 60/30/7 days and on expiry (in-app, email, SMS), dashboard "Compliance health" card.
- NCA category caps and tax/statutory rates (VAT, WHT, NCA levy (off), retention, SHIF, Housing Levy, NSSF) as editable settings with effective dates; NCA cap check for later tender/project phases.
- Plans as data (`con_plans`: Mjengo (KES 1,500, 1 site, no extra projects, optional KES 3,000 setup), Fundi, Contractor, Pro, Enterprise), `con_subscriptions`, `con_coupons` (PILOT50), 14-day Contractor trial on signup, M-Pesa payment via Tuma extends the paid period, 7-day grace then read-only, user limit enforced when adding staff, upgrade prompts (HTTP 402).
- Construction screens for Materials (bags, tonnes, m³... with buying price, on the shared catalogue) and adding staff by job (office / site access set for them); Cashier and Caretaker are refused for construction businesses (API-side). Light/dark switch; brand text stays readable in dark mode.
- Super-admin "Construction" screen: edit plans and coupons, MRR and tenants per plan, extend trials, apply coupons, record payments, run expiry alerts.
- Every create/update/delete is audit-logged with before/after.
- Migration `20261211100000_construction_foundation` (+ `rls.sql` policies), demo seed `prisma/seed-construction.ts` ("Uriri Builders Ltd", NCA5 Building, NCA6 Roads, Contractor plan), tests `scripts/e2e-construction.js` (98 checks).
