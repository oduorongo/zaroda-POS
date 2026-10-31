# Changelog

## Construction C4: materials, procurement, plant (2026-10-31)

- Each project gets its own site store (a branch on the shared inventory), created the first time materials go to it. No second inventory: LPOs are purchase orders to that branch, deliveries are goods received notes, and site stock is the normal stock ledger.
- Requisition (site) → approval (Project Manager / Contracts Manager; never by whoever raised it) → LPO (procurement; a DRAFT purchase order until approved). LPO approval follows the role approval limits (Project Manager KES 500,000, Contracts Manager KES 5M, Director unlimited; off on plans without approval limits) and the creator can never approve. Printable LPO in the brand colours (print / save as PDF).
- Deliveries by the storekeeper, part deliveries welcome; damaged items stay owed; over-delivery refused. Issues from the site store to a BQ item, or as wastage (new SITE_ISSUE stock movement; WASTE for wastage); never more than is on site.
- Material reconciliation per project: BQ allowance vs ordered, delivered, used, wasted, on site, wastage % and anything unaccounted for.
- Plant register (owned or hired, per day or per hour), daily logs of hours and fuel (one per machine per day), plant cost per project.
- Phone "Store" screen on the Site menu (receive, issue, request); Materials and Plant tabs on each project; Plant register.
- Core: `PurchaseOrdersService.createInTx` can create a DRAFT order; the new tables count as product history (a product used there is archived, not deleted).
- Migration `20261214100000_construction_materials_plant` (+ `rls.sql`), seed: cement / steel / ballast flow on the demo project (REQ-001 → LPO-001 with two deliveries → issues; LPO-002 awaiting approval; excavator and mixer logs); e2e now 294 checks.

## Construction C3: site diary, labour, safety (2026-10-30)

- Site diary, one per project per day (weather, works done, delays, visitors, plant, labour from the muster): written on site, submitted, approved and locked by the Project Manager.
- Geo-tagged site photos from the phone camera (shrunk before upload, private storage, GPS when the phone allows); site instructions register (SI-001...).
- Worker register with NCA card no. and expiry (expired cards highlighted); a worker marked supervisor needs a valid card. ID numbers and phones are masked in every list and in the audit log; full only for Director, Accounts and Compliance. Active workers count toward the plan limit.
- Phone muster roll: big Present / Half / Absent buttons, mark everyone present, works with no signal (marks queue on the phone and send by themselves; safe to resend).
- Safety: toolbox talks with attendees, PPE issue register, permits-to-work (max 7 days), incident register; lost-time and fatal incidents get a DOSHS deadline (7 days / 24 hours) with due and overdue alerts. Worker NCA cards join the expiry alerts.
- Who sees workers: company-wide labour roles see all; site staff only the workers on their projects.
- Migration `20261213100000_construction_site_labour_safety` (+ `rls.sql`), seed: 15 workers and 7 days of diaries, muster and safety records on "Uriri Day Secondary Classrooms"; e2e now 231 checks.

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
