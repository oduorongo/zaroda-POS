# ZARODA POS

Multi-industry, multi-tenant Point of Sale platform. See [DESIGN.md](./DESIGN.md)
for the architecture (module contract, entity model, ERD, offline sync
strategy) and the build roadmap.

## Status

**Phase 0 — Foundation: done and verified end-to-end against a live database.**

- pnpm monorepo (`apps/api` — NestJS core; `apps/backoffice` and
  `apps/terminal-pwa` are not scaffolded yet, planned for Phase 1).
- Prisma schema for the core entity model (`apps/api/prisma/schema.prisma`).
- Row-Level Security policies for tenant isolation (`apps/api/prisma/rls.sql`)
  — see that file's comments for the login-bootstrap exception and why it's
  scoped the way it is. **Also see `apps/api/prisma/create-app-role.sql` and
  DESIGN.md §2**: on Neon (and probably other managed Postgres), the default
  owner role has `BYPASSRLS`, which makes every policy here silently do
  nothing unless the app connects as a separate least-privilege role. This
  was caught and fixed by directly verifying "0 rows visible with no tenant
  set" against the live database, not just trusting that queries returned
  plausible-looking results.
- Auth: JWT login + PIN quick-login (shared-terminal cashier switching),
  RBAC guard, global `JwtAuthGuard`/`RolesGuard`. Exercised live: login,
  wrong-password rejection, PIN login (creates a `CashierSession`),
  wrong-PIN rejection.
- Tenant context: `AsyncLocalStorage`-based request scoping +
  `TenantScopedPrismaService.run()`, which sets the RLS session variable
  before every tenant-scoped query.
- `ModuleRegistryService` + `IndustryModuleManifest` — the module contract
  from DESIGN.md §3. No vertical modules registered yet (Phase 1: retail).
- CI (`.github/workflows/ci.yml`): install, `prisma generate`, typecheck,
  unit tests. E2E tests need a real database and aren't wired into CI yet
  (they do pass locally against the provisioned Neon database).

**Phase 1 — in progress.** Catalog module done and verified live:

- Categories, tax classes, products, and product variants — full CRUD, all
  routed through `TenantScopedPrismaService` (the first real use of the
  Phase 0 tenant-context plumbing for business logic, not just auth).
- RBAC in practice: reads open to any authenticated role (cashiers browse
  the catalog at the point of sale); writes restricted to
  `MANAGER`/`OWNER`. Verified live: a `CASHIER` token gets 200 on reads,
  403 on writes.
- RLS re-verified for the new tables after adding them, the same way as
  Phase 0 (0 rows visible with no tenant set) — including
  `product_variants`, whose policy is an `EXISTS` through `products` rather
  than a direct `organizationId` column.

Inventory module also done and verified live:

- `InventoryTransaction` (the append-only ledger, source of truth) and
  `InventoryItem.quantity` (the derived stock count) are kept in sync via
  an atomic `increment` inside the same tenant-scoped transaction as the
  ledger insert — not a read-then-write, so concurrent movements against
  the same branch+variant can't race each other into an inconsistent
  count. Verified live: +100 then -3 correctly derives 97, and the ledger
  shows both entries in order.
- Found and fixed a real schema gap while building this:
  `InventoryTransaction.branchId` had no foreign key to `branches` (unlike
  `InventoryItem`, which did) — added via a migration before writing the
  service, so an invalid branch id fails as a clean validation error
  instead of surfacing as a raw RLS policy violation.
- RBAC: stock levels readable by any authenticated role (a cashier needs
  to know if something's in stock); the ledger itself and recording
  movements are restricted to `SUPERVISOR`/`MANAGER`/`OWNER` (ledger reads
  also open to `AUDITOR`). Verified live with a `CASHIER` token.
- RLS re-verified for `inventory_items` and `inventory_transactions` (0
  rows visible with no tenant set).

Sales pipeline (cash) also done and verified live:

- `POST /sales`: line items priced from the current variant price, tax
  computed per line from the product's tax class, payments validated to
  sum to the total, inventory decremented per line item, and an audit log
  entry written - all inside one tenant-scoped transaction (sale
  creation + inventory ledger write + audit log commit or roll back
  together, never partially). Idempotent on `clientId`: a retried
  submission returns the original sale rather than double-selling.
- `PATCH /sales/:id/void`: reverses the inventory decrement (a `RETURN`
  ledger entry per line), marks the sale `VOIDED` (never deleted), and
  audit-logs the reason. Voiding an already-voided sale is rejected.
- **M-Pesa is deliberately not wired in yet.** `PaymentProcessor` is a real
  interface with `CashPaymentProcessor` (used) and `MpesaPaymentProcessor`
  (STK push implemented against the Daraja API spec, but unverified - no
  sandbox credentials in this environment). A sale submitted with a
  non-cash payment method is rejected with a clear error, not silently
  mishandled. Wiring M-Pesa into sale completion needs an async
  pending-payment status and a callback webhook, deferred until there are
  real credentials to design and test that against.
- Found and fixed a real issue while load-testing this against Neon:
  Prisma's default 5s interactive-transaction timeout was too tight for a
  sale's multiple round-trips over the connection's latency - raised to
  15s in `TenantScopedPrismaService`.
- Verified live end-to-end: a full sale (2 items, VAT-inclusive total
  computed correctly), inventory decrementing correctly, idempotent retry
  (no double-decrement), rejected mismatched payment totals, rejected
  M-Pesa attempts, a `CASHIER` ringing up a sale but getting 403 on void,
  an `OWNER` voiding successfully with inventory reversed and the audit
  log showing both `sale.created` and `sale.voided` with the correct
  actor, and RLS still denying `sales`/`sale_line_items`/`sale_payments`
  with no tenant set.

Shifts (X/Z-report cash reconciliation) also done and verified live:

- `POST /shifts`: opens a shift with an opening cash float. Only one open
  shift per terminal at a time - opening a second is rejected with a
  clear conflict error rather than silently allowing two concurrent
  drawers on one till.
- `GET /shifts/:id/report` (X-report): a live, non-mutating snapshot -
  sale count, total sales, payments broken down by method, and expected
  cash (`openingFloat + cash sales`). Works whether the shift is open or
  already closed.
- `PATCH /shifts/:id/close` (Z-report): records what the cashier actually
  counted against the same expected-cash figure, persists the variance,
  and closes the shift (never re-closeable). A mismatch doesn't block the
  close - it's informational, reconciled by a manager afterwards, same as
  a real till count.
- Found and fixed a float-precision cosmetic bug while testing: plain JS
  subtraction for variance (e.g. `680 - 685.6`) produced results like
  `-5.600000000000023` in the JSON report (the underlying `Decimal`
  column stored it exactly regardless) - rounded to the cent everywhere
  the report computes a money figure.
- Verified live: opening float correctly seeds expected cash, two sales
  against the shift correctly roll into the X-report totals and
  payment-method breakdown, closing with a short count produces a clean
  `-5.6` variance (not a float artifact), double-close and
  double-open-on-one-terminal are both rejected, and RLS still denies
  `shifts` with no tenant set.

Core reporting also done and verified live - the last API-only piece of
Phase 1:

- `GET /reports/sales-by-product`, `sales-by-branch`, `sales-by-cashier`,
  `sales-by-hour` - all filterable by `branchId`/`from`/`to`, all counting
  only `COMPLETED` sales (a voided sale's revenue never happened, and this
  was verified live: an earlier voided sale from the sales-pipeline test
  correctly doesn't appear in any report).
- COGS/margin needed a schema addition: `ProductVariant.cost` (nullable -
  not every tenant tracks cost, and a missing cost is never treated as
  zero, which would silently overstate margin).
- Found and fixed a correctness bug, not just cosmetic this time:
  hour-of-day bucketing using `Date.getHours()` would silently bucket by
  the *server's* local timezone (UTC in production) rather than Kenya's
  (EAT, UTC+3, no DST) - every sale's reported hour would have been off
  by 3. Fixed to convert explicitly from UTC rather than trust the
  server's local clock.
- Reports are restricted to `SUPERVISOR`/`MANAGER`/`OWNER`/`AUDITOR` (they
  reveal financial data across the whole branch, unlike a cashier's own
  shift report) - verified live with a `CASHIER` token getting 403.
- Verified live: margin computed correctly against a set cost
  (185.60 revenue - 110 cost = 75.60 margin on 2 units), branch/cashier
  aggregates matched expected totals, and the voided sale from the sales
  pipeline test was correctly excluded everywhere.

Terminal PWA (`apps/terminal-pwa`) - the offline-first sync design from
DESIGN.md §6, now scaffolded and built:

- **Backend additions this required**: `GET /org-users` (nothing let a
  client discover which cashiers exist to build a PIN picker from - a real
  gap found while designing this screen) and `GET /products` now includes
  `taxClass` (the terminal needs to compute an accurate total offline,
  before a sale is ever synced, not just after the server recomputes it).
- **Found and fixed a real bug that only a browser would have caught**:
  the backend had no CORS configuration at all. `curl`/server-to-server
  calls don't enforce CORS, so this would have looked fine in every test
  so far and then silently blocked *every single request* the terminal's
  browser `fetch()` calls actually make. Added `app.enableCors()` with a
  `CORS_ORIGIN` allowlist, and verified the actual preflight + request
  cycle with an `Origin` header set to the terminal's dev origin.
- **Setup flow** (`/setup`): one-time device provisioning - branch/terminal
  id (typed in; there's no backoffice provisioning UI yet to generate
  these, an acknowledged gap) plus a one-time manager email/password login
  used only to fetch and cache the cashier list and catalog snapshot into
  IndexedDB (Dexie). The manager's credentials aren't kept - the terminal
  switches to PIN-based cashier login from here on (DESIGN.md §9).
- **Login flow** (`/login`): a tappable cashier picker (from the cached
  list) + PIN pad, calling the existing `POST /auth/pin-login`.
  Deliberately requires connectivity (PIN validation is server-side) -
  the offline guarantee is about *selling*, not about a cashier's very
  first clock-in with no network at all.
- **POS flow** (`/pos`): catalog search/browse from the cached snapshot, a
  cart with live tax-inclusive totals computed from cached prices/rates, a
  cash-tendered/change-due checkout. Completing a sale always writes to
  a local Dexie `outbox` first (status `pending`, a client-generated
  `clientId`) - it does not wait on the network - then immediately
  attempts a sync in the background.
- **Sync engine** (`lib/sync.ts` + `hooks/use-sync-engine.ts`): drains the
  outbox in creation order against `POST /sales`, which is idempotent on
  `clientId` (a sale already accepted by the server is never
  re-submitted/duplicated even if the sync is interrupted and retried).
  Runs on mount, on the browser's `online` event, and on a 30s fallback
  poll (a device can report `navigator.onLine = true` while requests still
  fail on a flaky connection, which is exactly why sync treats a failed
  request as "still offline, retry later" rather than trusting that event
  alone).
- A hand-written service worker (`public/sw.js`) caches the app shell only
  (cache-first with a network fallback) - API responses are deliberately
  never cached by the browser's HTTP cache, since IndexedDB + the sync
  engine above is a correctness-aware cache (idempotent, ledger-based) and
  a generic HTTP cache has no idea a sale must never be silently
  duplicated or served stale.
- **Verified**: typecheck, lint, and production build all pass for the new
  app; every route returns 200 with correct server-rendered content; the
  full `/auth/login` → `/org-users` → `/products` chain the setup screen
  depends on was exercised live in earlier phases and re-verified here
  with the `Origin` header the browser will actually send. **Not yet
  verified**: the actual client-side IndexedDB read/write flows and
  full click-through UX in a real browser - no browser-automation tool
  is available in this environment. The next session with real device/
  browser access should exercise: setup → PIN login → ring up a sale
  offline (dev tools "offline" throttling) → reconnect → confirm it syncs
  exactly once.
- Icons referenced in `public/manifest.json` (`icon-192.png`,
  `icon-512.png`) don't exist yet - a cosmetic gap (install-prompt polish
  only, doesn't affect functionality) worth filling before a real device
  install.

Still to do in Phase 1 beyond that: nothing - catalog, inventory, sales,
shifts, reporting, and the terminal PWA are all built.

**Phase 2 — Stock transfers and stock takes: done and verified end-to-end
against a live database.**

- **Stock transfers** (`POST /stock-transfers`, `GET /stock-transfers`,
  role-gated to supervisor/manager/owner): moves stock between two
  branches for the same organization as a single logical operation - one
  `StockTransfer` record plus two ledger entries (a negative
  `InventoryTransaction` at the source, a positive one at the destination,
  both `type: TRANSFER` sharing the transfer's id as `referenceId`) written
  in the same database transaction, so a transfer can never leave stock
  "in transit and unaccounted for." Same-branch transfers
  (`fromBranchId === toBranchId`) are rejected with 400.
- **Stock takes** (`POST /stock-takes` opens one, snapshotting every
  `InventoryItem` at the branch into a `StockTakeLine` with a fixed
  `systemQuantity` so a count that takes hours isn't compared against a
  quantity that keeps moving from concurrent sales; `PATCH
  /stock-takes/:id/lines/:lineId` records a counted quantity and computes
  `variance`; `PATCH /stock-takes/:id/complete` reconciles every non-zero
  variance into the ledger as a `STOCKTAKE` inventory transaction and
  marks the take `COMPLETED`). Lines nobody got around to counting are
  left alone, not treated as "counted zero." A completed stock take
  rejects further count edits or a second completion with 400.
- Both features reuse the existing `InventoryTransactionsService
  .recordInTx(tx, dto)` composable core (no duplicated stock-adjustment
  logic) and log to the audit trail (`stock_transfer.created`,
  `stock_take.opened`, `stock_take.completed`).
- New tables (`stock_transfers`, `stock_takes`, `stock_take_lines`) needed
  their own RLS policies (`stock_take_lines` has no direct
  `organizationId` column, so its policy scopes through
  `stock_take_lines.stockTakeId -> stock_takes.organizationId` via
  `EXISTS`) - applied to the live database and confirmed the
  already-provisioned `zaroda_app` role's default privileges extended
  automatically to the new tables with no manual grant needed.
- **Verified live** against the real Neon database and a running API
  process, not just typechecked: a transfer of 20 units Main → Westlands
  correctly moved stock (95→75 at Main, 0→20 at Westlands); a stock take
  opened at Main correctly snapshotted `systemQuantity: 75`; recording a
  count of 72 computed `variance: -3`; completing the take reconciled
  Main's stock to 72 and wrote a `STOCKTAKE` ledger entry with
  `quantityDelta: -3`; re-completing or editing counts on the now-
  `COMPLETED` take both correctly returned 400; a cashier token got 403 on
  every endpoint on both controllers (role gate confirmed); and a raw
  script querying `stock_transfers`, `stock_takes`, and `stock_take_lines`
  with no tenant context set confirmed 0 rows visible on all three (RLS
  confirmed, same pattern as every other table in this project).
  `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass
  clean for `apps/api`.

**Phase 2 — Sale-level discounts: done and verified end-to-end against a
live database.**

- `POST /sales` now accepts an optional `discount: { type: PERCENT|FIXED,
  value, approvedById }`. The schema's `Discount` model already existed
  from Phase 0 (`saleId`, `type`, `value`, `approvedById`) but was never
  wired into the sale-creation flow until now.
- Applied to the post-tax ticket total (the amount actually charged), not
  the pre-tax subtotal - matches how a cashier physically keys "10% off
  the whole ticket" at the register, and avoids re-deriving per-line tax
  on a discounted subtotal for a case this small a pilot doesn't need.
- The approver is **re-verified against the database on every sale**, not
  trusted from the client: `approvedById` must resolve to a real `OrgUser`
  in the tenant holding SUPERVISOR/MANAGER/OWNER - a cashier passing their
  own id (or any id that doesn't hold one of those roles) is rejected with
  400, so self-approval isn't possible just by shaping the request body.
  `PERCENT` is capped at 100; either discount type is rejected with 400 if
  it would exceed the sale's total.
- The sale's persisted `total` is the post-discount amount actually
  collected (matches what shift cash-reconciliation and reporting already
  sum); the `Discount` row retains the original type/value so the
  pre-discount amount is always derivable. The audit log
  (`sale.created`) records the computed discount amount and approver
  alongside the total.
- **Verified live**: a 10%-off sale on an 80 KES item with 16% tax
  (92.80 → 83.52) computed and persisted correctly, decremented inventory
  exactly once, and the audit log captured the right discount breakdown;
  a cashier-id approver, a nonexistent-id approver, a FIXED discount
  larger than the ticket, and a PERCENT above 100 were each independently
  rejected with 400 without ever touching inventory or creating a sale; a
  raw query with no tenant context set confirmed 0 rows visible on
  `discounts` (RLS, inherited from the existing tenant-isolation policy on
  that table). `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm
  lint` all pass clean for `apps/api`.

**Phase 2 — Low-stock alerts: done and verified end-to-end against a live
database.** Scoped deliberately: the original spec called for Redis/
BullMQ + Africa's Talking SMS, but neither is provisioned yet (same
situation M-Pesa was in - see the sales-pipeline decision above). Rather
than stand up new infra nobody could verify against real credentials,
this increment builds the durable, fully-testable half now and leaves SMS
delivery as a thin future consumer of it, exactly how M-Pesa was
scaffolded-but-not-wired.

- New `LowStockAlert` model + `PATCH /inventory/items/:branchId/:variantId
  /threshold` (manager+ only - `InventoryItem.lowStockThreshold` existed
  in the schema since Phase 0 but had no API to actually set it until
  now) and `GET /inventory/alerts` (manager+/auditor, `branchId` filter,
  `includeResolved` to see history).
- Detection is synchronous and lives in
  `InventoryTransactionsService.recordInTx` - the single place every
  quantity change already funnels through (sales, transfers, stock takes,
  manual adjustments) - so no cron/poller was needed and every existing
  caller got alerting for free with zero changes to `SalesService`,
  `StockTransfersService`, or `StockTakesService`. A threshold of 0 (the
  default) means "not tracked," so untouched items never alert. At most
  one OPEN alert exists per branch+variant - re-crossing below the
  threshold while already OPEN does not create a duplicate - and it
  auto-resolves the moment quantity rises back above the threshold.
- **Verified live**: setting a threshold above current stock created no
  alert; a manual `ADJUSTMENT` crossing below it opened exactly one alert
  with the correct quantity/threshold snapshot; a second adjustment while
  still below threshold did not create a duplicate (confirmed count stayed
  at 1); restocking above the threshold auto-resolved it (confirmed via
  `includeResolved=true`); a real sale crossing the threshold triggered
  the exact same alert path with no sales-module-specific code, proving
  the shared `recordInTx` hook actually is shared; a cashier token got 403
  on both new endpoints while `GET /inventory/items` stayed open to them;
  and a raw query with no tenant context set confirmed 0 rows visible on
  `low_stock_alerts` (RLS). `pnpm typecheck`, `pnpm build`, `pnpm test`,
  and `pnpm lint` all pass clean for `apps/api`.

**Phase 2 — Customers and loyalty points: done and verified end-to-end
against a live database.**

- New `Customer` model (`name`, `phone` unique-per-org, `loyaltyPoints`)
  and `POST/GET /customers`, `GET /customers/:id` - open to any
  authenticated role including cashier, since looking up or registering a
  customer happens at the register itself, not in a back-office. `Sale`
  gained an optional `customerId` plus `pointsEarned`/`pointsRedeemed`
  columns (denormalized onto the sale so a receipt/history always shows
  what happened on that specific ticket, independent of the customer's
  current running balance).
- `POST /sales` now accepts optional `customerId` and `redeemPoints`.
  Rates are hardcoded org-wide for the pilot rather than a per-org config
  table (1 point earned per 100 currency spent, floored; each redeemed
  point worth 1 currency unit) - a real config screen is a natural
  follow-up once there's a back-office UI to put it in, same deferral
  pattern used for M-Pesa credentials.
- Redemption requires `customerId`; the customer's points balance is
  re-verified against the database on every sale (never trusted from the
  client) before allowing a redemption, and a redemption that would exceed
  the sale's total is rejected with 400. Points are earned on the amount
  actually paid (post-discount, post-redemption) - earning points from
  redeemed points would let a balance grow out of nothing.
- Voiding a sale reverses its loyalty effect (gives back redeemed points,
  takes back earned points). If the customer has since spent the earned
  points elsewhere, this can take their balance negative - accepted
  deliberately, the same "never block, reconcile after the fact"
  principle already applied to offline stock conflicts (DESIGN.md §6),
  rather than blocking the void.
- **Verified live**: a 3-unit sale (278.40) earned exactly 2 points
  (floor(278.40/100)); a customer's balance correctly accumulated across
  sales; redeeming 5 of 11 points correctly reduced a 92.80 ticket to
  87.80 and left a balance of 6; over-redeeming (100 points against a
  balance of 6) and redeeming without a `customerId` were both rejected
  with 400 without creating a sale; voiding a 9-point-earning sale
  correctly reversed the balance (6 → -3, confirming the negative-balance
  behavior is intentional, not a bug); a duplicate phone number on
  customer creation was rejected with 409; a cashier could create/list
  customers (by design) while a raw query with no tenant context set
  confirmed 0 rows visible on `customers` (RLS). `pnpm typecheck`, `pnpm
  build`, `pnpm test`, and `pnpm lint` all pass clean for `apps/api`.

**Phase 2 — Layaway: done and verified end-to-end against a live
database.**

- New `Layaway`/`LayawayLineItem`/`LayawayPayment` models. A layaway
  requires a `Customer` (unlike a sale, where one is optional) since the
  whole point is tracking a specific person's balance over time. Prices
  and tax are snapshotted into the line items at creation, same as a sale,
  so a later price change doesn't retroactively change what the customer
  agreed to pay.
- Deliberately does **not** touch inventory at creation - modeling a
  non-committal "hold" would need a new inventory-transaction type just to
  represent stock that isn't actually sold yet, and this pilot's existing
  stock-conflict philosophy is already "never block, reconcile after the
  fact" (DESIGN.md §6). Stock is only decremented at `PATCH
  /layaways/:id/complete` (pickup), via the exact same
  `InventoryTransactionsService.recordInTx` a sale uses, with `type:
  SALE`.
- `POST /layaways/:id/payments` records a deposit/installment (cash-only,
  same reasoning as sales) any number of times while `OPEN`, rejecting
  anything that would overpay the balance. `complete` requires the balance
  fully paid first. `cancel` is restricted to supervisor+ (same tier as
  void-sale) and is deliberately just a status change - it does not
  auto-generate a cash refund for any deposit already paid, since
  refund-vs-forfeit-vs-store-credit is a store-policy call this pilot
  doesn't make on the tenant's behalf; the audit log records the deposit
  amount at cancellation time so that decision can be handled manually.
- **Verified live**: creating a 5-unit layaway (464.00) left stock
  completely untouched; a partial deposit correctly updated the balance;
  completing before the balance was fully paid was rejected with 400
  (showing the exact remaining amount); a payment that would overpay the
  balance was rejected with 400; paying the exact remainder and completing
  correctly decremented stock by 5 (70 → 65) at that moment, not earlier;
  re-completing or paying an already-completed layaway were both rejected
  with 400; a cashier was correctly blocked (403) from cancelling while
  the owner could; and a cancelled layaway left stock untouched (nothing
  to reverse, since nothing was ever decremented) while a raw
  no-tenant-context query confirmed 0 rows visible across `layaways`,
  `layaway_line_items`, and `layaway_payments` (RLS). `pnpm typecheck`,
  `pnpm build`, `pnpm test`, and `pnpm lint` all pass clean for
  `apps/api`.

That closes out every software-only item in the Phase 2 roadmap. What's
left - ESC/POS receipt printer integration and barcode scanner
integration - needs physical hardware to verify live the same way
everything above was verified, so those (and the SMS delivery half of
low-stock alerts, deferred until real Africa's Talking credentials exist)
are the natural point to pause and decide how to proceed. Phase 3
(non-functional hardening) is next per the roadmap in DESIGN.md.

## Getting started

```
pnpm install
cp apps/api/.env.example apps/api/.env
```

Then see [apps/api/prisma/README.md](./apps/api/prisma/README.md) for the
full database setup order (migrate → apply RLS → **create the app role** →
seed) — the app-role step is not optional, see the Status section above.

```
pnpm --filter api start:dev
```

Then the terminal PWA (separate terminal, needs the API already running -
set `CORS_ORIGIN` to include `http://localhost:3002` in `apps/api/.env`,
or leave it unset for local dev):

```
pnpm --filter terminal-pwa dev
```

Open http://localhost:3002, and on first run it'll redirect to `/setup` -
you'll need a branch id and terminal id (query them from the database, or
use the ones the seed script prints - see `apps/api/prisma/seed.ts`) and a
manager login (the seeded demo owner: `owner@demo.zaroda.pos` /
`password123`).

## Repo layout

```
apps/
  api/              NestJS core (modular monolith)
  backoffice/        Next.js back-office UI          [Phase 2+]
  terminal-pwa/       Offline-capable POS terminal (Dexie/IndexedDB,
                      service worker, sync engine - DESIGN.md §6)
packages/
  modules/
    retail/          First vertical module            [Phase 2]
```
