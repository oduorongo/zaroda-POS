# 00 — Construction Module: Discovery & Plan (C0)

Written after studying the repo on branch `feature/construction` (2026-10-30). No code changed.

## 0. Headline differences from the spec pack
The spec pack assumes a slightly different stack. These facts override the specs wherever they disagree:

| Spec says | Repo actually has |
|---|---|
| TypeORM entities | **Prisma** — one shared `apps/api/prisma/schema.prisma` (5,400 lines), SQL migrations in `prisma/migrations/` |
| `tenantId`, `tenants` table | **`organizationId`** → `Organization` (`organizations` table). Tenant isolation is **Postgres RLS** (`prisma/rls.sql`) plus `TenantScopedPrismaService` |
| `tenant.businessType = CONSTRUCTION` | **`Organization.industryType`** (plain string). Use `industryType = 'CONSTRUCTION'` |
| `users` table with roles | `User` (login) + **`OrgUser`** (membership, single `Role` enum: CASHIER/SUPERVISOR/MANAGER/OWNER/AUDITOR/CARETAKER) |
| `products`, `stock_movements` with `locationType=SITE` | `Product` → `ProductVariant`; stock is **per `Branch`** in `InventoryItem` + append-only `InventoryTransaction`. No location types |
| `payments`, `etims_invoices`, `audit_logs` | `SalePayment`/`MpesaStkRequest`, `EtimsDocument`, `AuditLog` (`audit_log`) |
| NestJS `construction` module + Next.js `/construction/*` | NestJS API in `apps/api`; the business screens are the Next.js **backoffice** app (`apps/backoffice`, served at `app.zarodashop.com`) |
| Session cookies | Backoffice keeps the JWT in **localStorage** (per-origin, so it's still not shared across domains — same outcome) |

## 1. How business types are registered and switched on
- `Organization.industryType` is set at signup (`RegisterOrganizationDto.industryType`, `auth.service.ts`). Values in use: RETAIL, RESTAURANT, HOTEL, PHARMACY, SALON, SERVICE, MANUFACTURING, RENTAL, SCHOOL_SUPPLIER.
- Each vertical is a NestJS module that registers an `IndustryModuleManifest` with `ModuleRegistryService` on init (`src/module-registry/`) — declaring its tables, UI panels, reports and core-event hooks. Examples: `rental.module.ts`, `school-supplier.module.ts`.
- Backend gating is done per service (`if (org.industryType !== 'RENTAL') throw ...`) plus `@Roles()` guards.
- Frontend: at login the backoffice fetches `GET /organizations/me` and stores `industryType` in the session; `components/nav.tsx` shows vertical links via `VERTICAL_LINKS[industryType]` and inline checks.
- **Construction plan:** `industryType = 'CONSTRUCTION'`, a `ConstructionModule` with its own manifest, plus a reusable `ConstructionGuard` that rejects non-construction orgs (instead of repeating the inline checks).

## 2. Where the core pieces live
| Piece | Location |
|---|---|
| Auth (JWT, PIN, guards) | `apps/api/src/auth/` — `jwt-auth.guard.ts`, `roles.guard.ts`, `roles.decorator.ts`, `public.decorator.ts` |
| Tenant context / RLS | `src/common/tenant/`, `src/common/prisma/tenant-scoped-prisma.service.ts`, `prisma/rls.sql`, `scripts/apply-rls.js` |
| Organizations / branches / staff | `src/organizations/`, `src/branches/`, `src/org-users/` |
| Products / catalog | `src/catalog/` (Product, ProductVariant, Category, TaxClass) |
| Suppliers / POs / receiving / bills | `src/purchasing/` (Supplier, PurchaseOrder, GoodsReceipt, SupplierBill + payments) |
| Stock | `src/inventory/`, `src/stock-transfers/`, `src/stock-takes/`, `src/waste/` |
| M-Pesa (Daraja) | STK push: `src/payments/mpesa-payment.processor.ts`; **B2C payouts**: `src/sales-teams/mpesa-b2c.client.ts`; rental has its own `rental-mpesa.*` |
| eTIMS | `src/etims/` (EtimsDocument, devices, items, purchases) |
| General ledger | `src/accounting/` (LedgerAccount, JournalEntry, LedgerPosting) |
| Audit log | `src/common/audit/audit-log.service.ts` → `AuditLog` (actor, action, entity, before/after JSON) |
| File uploads | `src/common/storage/object-storage.service.ts` — **public** Vercel Blob store |
| Payroll | `src/payroll/` (PayrollProfile, PayrollRun, Payslip) + `src/common/payroll/kenya-statutory.util.ts` |
| SMS / email alerts | `src/notifications/`, `src/alerts/`, `src/common/email/` |
| Scheduled jobs / queue | `src/queue/` (BullMQ), `worker.ts` |
| Subscriptions / plans | `Plan`, `Subscription`, `SubscriptionPayment` + `src/platform-admin/subscriptions.util.ts`, `src/public-plans/` |
| External portal precedent | `src/rental/portal/` (rental tenants sign in with an emailed code) |
| Super-admin UI | `apps/platform-admin` |

## 3. What construction reuses, and the gaps
**Reuse as-is**
- Organization, User/OrgUser, JWT auth, RLS tenant isolation, `AuditLogService` (already records before/after).
- Products/variants as the materials catalogue; Suppliers.
- `PurchaseOrder` → `GoodsReceipt` → `InventoryTransaction` for LPO/GRN, with construction-specific approval data in `con_` extension tables (not a forked PO system).
- `ObjectStorageService` for uploads, eTIMS for IPC invoices, `mpesa-b2c.client.ts` for payroll payouts, BullMQ worker for expiry alerts, the general ledger for IPC/retention postings.
- **School-supplier module as a pattern library** — it already has tenders, compliance docs with expiry, contracts, variations and retention. Copy its patterns, don't link to its tables.

**Gaps to fill**
1. **Site stock locations.** No location types. Simplest fit: **each project site gets its own `Branch`** (`con_projects.branchId`). Then the existing stock ledger, transfers, stock-takes and POs all work per site with no core change. `con_site_stock` becomes a view/query, not a table.
2. **Construction roles.** `Role` is one enum per membership. Plan: keep OrgUser.role for core access (e.g. MANAGER), and add `con_user_roles` (company-level) + `con_project_members` (project-level) with a `@ConRoles()` decorator and `ConProjectGuard`. External portal users are separate identities like rental tenants (not OrgUsers), so they never count toward user limits.
3. **Private files.** The Blob store is **public** — fine for product photos, not for ID copies, permits and contracts. Need either a private Blob store with signed URLs or unguessable keys + server-proxied download. Recommend a private store (C1 decision).
4. **Rates as settings.** Payroll's statutory rates (PAYE, SHIF, NSSF, Housing Levy) are **hard-coded** in `kenya-statutory.util.ts`. Construction payroll needs `con_tax_settings` with effective dates; the util should be refactored to take rates as inputs (core keeps its current defaults).
5. **Casual workers.** Core payroll is for OrgUsers (staff who log in). Site casuals don't log in → separate `con_workers` / `con_payroll_*` tables, reusing only the statutory calculator and B2C client.
6. **Segregation of duties / approval limits.** Not a general core feature (PayrollRun has createdBy/approvedBy only). Build as a small construction helper.
7. **No CHANGELOG file exists** — C1 will create `CHANGELOG.md` at the root.
8. **No Next.js middleware** in the backoffice today — host-based routing is new.

## 4. Folder layout
**Backend** (`apps/api`)
```
src/construction/
  construction.module.ts        # manifest: industryType 'CONSTRUCTION'
  common/                       # ConstructionGuard, @ConRoles, ConProjectGuard, @ConFeature, settings, money utils
  plans/                        # con_plans, con_subscriptions, coupons, limits
  compliance/                   # registrations, docs vault, category caps, expiry alerts
  tenders/
  projects/                     # projects, parties, members, permits, milestones, BQ import
  site/                         # diaries, photos, instructions
  labour/                       # workers, muster
  safety/
  materials/                    # requisitions, LPO/GRN extensions, issues, reconciliation
  plant/
  commercial/                   # valuations, IPCs, variations, retention, subcontracts
  payroll/
  portal/                       # external client/consultant/subcontractor access
  reports/
prisma/schema.prisma            # con_* models appended in one "Construction" section
prisma/migrations/<ts>_construction_*/
prisma/rls.sql                  # policies for every con_* table
prisma/seed-construction.ts     # demo tenant "Uriri Builders Ltd"
scripts/e2e-construction.js
```
**Frontend** (`apps/backoffice`)
```
middleware.ts                   # host → product (POS | CONSTRUCTION); ?product=construction on localhost
app/construction/...            # /construction/dashboard, /projects/[id]/..., /site, /labour, ...
app/construction/(public)/      # construction landing, pricing, signup (shown on CONSTRUCTION_DOMAIN)
components/construction/        # navy/gold/orange theme, mobile-first site screens
```
Construction users see a construction-only nav; core screens they need (Suppliers, Products, Staff) are linked from it.

## 5. Existing subscription/billing tables
- Core has `Plan` (tier, priceKes, maxDevices, maxBranches), `Subscription` (one per org, computed TRIAL/ACTIVE/GRACE/SUSPENDED, 7 grace days) and `SubscriptionPayment` (recorded manually by a platform admin).
- **Rental already set the precedent** of a vertical with its own plans: `needsDeviceSubscription()` excludes RENTAL, and rental plans/billing live in the rental module (plans hard-coded in `rental-plans.util.ts`).
- **Recommendation:** follow the rental precedent: exclude CONSTRUCTION from the device subscription and build `con_plans` / `con_subscriptions` / `con_coupons` as the spec says (as **database rows**, not hard-coded like rental). Reuse `effectiveStatus()` logic for TRIAL/GRACE/SUSPENDED and the existing M-Pesa/TUMA payment flow. Core `Plan` can't hold project/worker limits or feature lists without changing core.
- Since each site becomes a Branch, construction must never be held to core's `maxBranches`, which is another reason to keep it off the device subscription.
- Sales-agent commission: orgs already carry `salesAgentId`/`salesTeamId`, and `src/sales-teams/` computes earnings. Reuse those instead of a new `agentId` on `con_subscriptions`.

## 6. Risks and conflicts
1. **Domains.** The spec says `POS_DOMAIN=zarodashop.com`, but POS is split across `app.` (backoffice), `pos.` (till), `shop.` (storefront) and `api.zarodashop.com`. `build.zarodasolutions.app` must be added to the **backoffice** Vercel project, and the "construction tenant on POS domain → redirect" rule applies to `app.zarodashop.com`. Suggest `POS_DOMAIN=app.zarodashop.com`.
2. **API host.** The spec says Railway; repo comments mention Render. Whichever hosts `api.zarodashop.com` needs `https://build.zarodasolutions.app` added to `CORS_ORIGIN` (if set).
3. **Single schema file.** Every `con_` model goes into the shared `schema.prisma`, and each needs an RLS policy in `rls.sql` (`rls-coverage.spec.ts` will fail otherwise). Migrations must run, then `apply-rls`, **before** merging. `apply-rls.js` targets LIVE unless `ENV_FILE=.env.local`.
4. **Money type.** Spec allows `numeric(14,2)` — matches the repo (`Decimal @db.Decimal(14,2)`). Use that, not cents.
5. **Immutability.** Certified valuations/IPCs must be correctable only by reversals. Enforce in services, and optionally with a DB trigger blocking UPDATE on certified rows.
6. **Out-of-scope note is stale.** Spec says "full general ledger lives elsewhere", but the repo now has a GL (`src/accounting/`). IPCs, retention and payroll should post to it, probably as a C5/C6 addition.
7. **Site = Branch side effects.** Branch-based screens (terminals, shifts, sales reports) would list site branches. Mark site branches (e.g. a `kind` or a link from `con_projects`) and hide them from POS-only screens. This touches core lightly, so it is a C1 decision.
8. **NCA caps, levy, tax rates** are seed data only. The figures in 04 must be checked against NCA/KRA before go-live.
9. **Data protection.** Worker IDs/phones must be masked in lists and never returned to portal endpoints. Enforce in DTO/select shapes, not the UI.
10. **Size.** This is the largest module so far (~45 tables). Keep each phase on its own stacked branch/PR so nothing half-built reaches `main`.
11. **Spec pack location.** `docs/` and `prompts/` are still inside `zaroda-construction/`, not at the repo root as the README says. CLAUDE.md points at `docs/construction/`, so they should be moved to the root before C1.
