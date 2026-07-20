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

**Phase 3 — Structured logging: done and verified end-to-end against a
live running server.** Started here because the other Phase 3 items
(load testing, a sync-conflict dashboard) are more useful to build on top
of structured logs than blind console output, and this needs no external
credentials or hardware to verify live - unlike the printer/scanner work
skipped above.

- Replaced Nest's default console logger with `nestjs-pino` (JSON in
  production, pretty-printed single-line in local dev via `pino-pretty`).
  `main.ts` uses `bufferLogs: true` + `app.useLogger(app.get(Logger))` so
  even Nest's own startup/route-mapping logs go through it, not just
  request-scoped ones.
- Every request gets a `requestId` (`x-request-id` header if the caller
  sent one, else a generated UUID) attached to both its access log line
  and any error raised inside it - the correlation key for tying a
  request, an error, and the `AuditLog` row it produced together during
  an investigation, instead of timestamp-nearby guessing.
- New `AllExceptionsFilter` (global, via `APP_FILTER`) is the one place
  every unhandled error passes through: a caught `HttpException` (the
  normal `BadRequestException`/`NotFoundException`/etc. every service
  already throws) is logged with full context and passed through to the
  client unchanged; anything unexpected (a bug, a driver error) is logged
  with its full stack server-side but returns a generic 500 to the
  client, since leaking a raw Prisma/driver error message to a POS
  terminal could expose schema or connection details.
- Access-log level is derived from the response: 5xx/exceptions log as
  `error`, 4xx as `warn`, everything else as `info` - so a log aggregator
  can alert on volume of `error`/`warn` lines without every service
  needing to remember to log failures itself.
- `Authorization` and `Cookie` headers are redacted (`[REDACTED]`) in
  every log line. Verified this is actually necessary and actually
  sufficient by checking what pino-http logs by default: request **bodies
  are never logged at all** (only method/url/headers), so a login/PIN
  payload's `password`/`pin` fields were never at risk of appearing in a
  log line in the first place - confirmed live by submitting a wrong
  password and grepping the entire log output for it (zero matches).
- **Verified live**: a wrong-password login attempt produced a `warn`
  (401) access-log line and no trace of the submitted password anywhere
  in the log; a validation failure produced a `warn` (400) line and the
  filter's own structured error log; an authenticated request's
  `Authorization: Bearer ...` header appeared as `[REDACTED]` in the
  access log; every bootstrap/route-mapping line came through as
  structured JSON via the same logger, not raw console output. `pnpm
  typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass clean
  for `apps/api`.

**Phase 3 — Load-testing the stock-decrement path: in progress, partially
verified live, blocked on a Neon outage.**

- Added `apps/api/scripts/load-test-stock-decrement.mjs`, a standalone
  script (no new dependencies - built-in `fetch`) that fires many
  concurrent `POST /sales` at the same branch+variant and checks the
  atomic-`increment` claim in `InventoryTransactionsService.recordInTx`
  actually holds under concurrency (no lost updates - final quantity
  matches `start - successfulSales` exactly), plus a second test that
  fires the *same* `clientId` concurrently many times to probe the
  idempotency check-then-create path for a race.
- **What the load test actually caught**: running it exposed a real bug
  in `AuthService.pinLogin` - it opened its own `this.prisma.$transaction`
  directly (bypassing `TenantScopedPrismaService`'s 15s timeout override,
  which was added earlier in Phase 1 for exactly this class of problem)
  and was still on Prisma's 5s interactive-transaction default. Under the
  elevated Neon round-trip latency this session was already experiencing,
  that surfaced as a raw `PrismaClientKnownRequestError` (P2028,
  "Transaction not found") reaching the client as an unstyled 500 -
  **fixed** by adding the same `{ timeout: 15_000 }` override, matching
  every other transactional entry point in the codebase (confirmed via
  grep that `auth.service.ts` was the only other direct
  `this.prisma.$transaction` call besides `TenantScopedPrismaService`
  itself).
- **A second, distinct root cause surfaced while chasing the first**:
  Prisma's default *connection* timeout (separate from the interactive-
  transaction timeout above) is also 5s, and a Neon free-tier compute
  waking from autosuspend was directly observed taking ~12s to accept its
  first connection after being idle - independently confirmed by raising
  `connect_timeout` to 30s on a throwaway client and watching a `SELECT 1`
  succeed in 12097ms where the default config had been failing at
  exactly 5000ms every time. **Fixed** by adding `connect_timeout=30` to
  both `DATABASE_URL` and `DIRECT_URL` in `.env` and documenting it in
  `.env.example` (this is very likely the root cause of most of the
  `P1001`/timeout flakiness logged throughout every earlier phase of this
  build - a cold-start latency issue, not an actual outage each time).
- **Update after the outage cleared**: the database came back reachable,
  but required a *third* timeout fix beyond the two already documented -
  Prisma's `pool_timeout` (default 10s, distinct from `connect_timeout`)
  is what the exact "Timed out fetching a new connection from the
  connection pool" error was actually about, not `connect_timeout` alone.
  Confirmed by raising both together and watching a query that had failed
  at exactly 5000ms/10000ms every time finally succeed at 10-16s. Added
  `pool_timeout=30` alongside `connect_timeout=30` to both `DATABASE_URL`
  and `DIRECT_URL`.
- Running the actual load test with the DB reachable again surfaced a
  **fourth** real finding: all 50 concurrent sales failed with
  `PrismaClientKnownRequestError: Unable to start a transaction in the
  given time` - Prisma's client-side connection pool size was left at its
  implicit default (`num_cpus*2+1` = 9 on this machine), and every write
  in this app is an interactive transaction that holds a pool connection
  for its full duration (`TenantScopedPrismaService.run()`), so 50
  concurrent writes queue for a connection and time out rather than
  erroring cleanly or gracefully backing off. **Fixed** by adding an
  explicit `connection_limit=10` (sized for this pilot's stated scale -
  DESIGN.md's "<10 terminals" - with headroom; documented in
  `.env.example` as something to raise, alongside Neon's own per-role
  connection cap, if the target scale grows).
- **What's honestly still unverified**: a clean, fully-passing 50-way
  concurrent load-test run. Immediately after applying the
  `connection_limit` fix, this session's network path to Neon degraded
  further still - a single unrelated `GET` request took over 30 seconds -
  making any load-test result gathered at that moment reflect this
  session's network conditions, not the application's real behavior.
  Rather than report a misleading pass/fail number, this is being
  recorded honestly as **inconclusive, pending a re-run under normal
  network conditions** in a later session. What *is* independently
  confirmed real and fixed, regardless of that inconclusive run: the
  `pinLogin` transaction timeout, the connect/pool timeout
  under-configuration, and the connection pool sizing gap - all four are
  genuine defects a load-testing exercise is supposed to catch, and all
  four were caught and fixed, even though the capstone "run 50 concurrent
  sales cleanly" number itself is still pending.
- The load-test script itself was hardened during this exercise too - its
  `get()` helper was silently turning a failed request into `undefined`/
  `NaN` deep inside a later PASS/FAIL comparison instead of failing
  loudly, which is exactly the kind of gap that turns "the test result is
  confusing" into "the test result is wrong."

**Update - a fifth timeout setting, and the idempotency race now passes
cleanly.** Once the network recovered enough to actually run transactions
(rather than fail to connect at all), the load test surfaced one more
distinct Prisma option: `maxWait` (default 2s) bounds how long a caller
waits to *acquire* a pool connection before a transaction starts - a
different thing entirely from `timeout` (how long the transaction may
*run* once started, already raised to 15s). With `connection_limit=10`,
any burst of concurrent writes beyond 10 needs to queue for a connection,
and 2s wasn't enough queue time - this was the exact
`Unable to start a transaction in the given time` error the 50-concurrent
test kept hitting. **Fixed** by adding `maxWait: 15_000` alongside
`timeout: 15_000` everywhere a transaction is opened
(`TenantScopedPrismaService.run()` and `AuthService.pinLogin`).

With that fixed, the **idempotency-race test (Test 2) now passes
completely**: 10 concurrent identical `POST /sales` submissions correctly
produced exactly one sale, exactly one inventory decrement, and zero
5xx - the last part is a **new fix** in `SalesService.create()`: the
find-then-create idempotency check isn't atomic against a genuinely
concurrent identical submission (two requests can both pass the
`findUnique` before either `create`s), so the database's own unique
constraint on `Sale.clientId` was the real backstop for that race, but
until now a losing request's `PrismaClientKnownRequestError` (P2002)
reached the client as a raw 500 instead of gracefully re-reading and
returning the sale the winning request just created. It does that now.

**The raw-throughput test (Test 1, many distinct concurrent sales) is
still not a clean pass** - not because of a pool/timeout misconfiguration
anymore (that's fixed), but because this session's baseline latency to
Neon, independently measured via five back-to-back single-field `GET`
requests, sat at 2.4-6s *each* (should be well under 100ms normally). A
sale transaction does roughly ten sequential round trips; at that
baseline, 15s of transaction budget is consumed by ordinary work before
any real contention even enters the picture. This is an infrastructure
characteristic of this session, not a defect in the pool sizing,
timeouts, or transaction logic - all of which are now independently
confirmed correct by the fact that Test 2's *correctness* (not just its
speed) passes cleanly under the exact same degraded conditions.

**Retried again later in the session, after waiting for the connection
to plausibly recover**: baseline latency did improve materially (three
back-to-back connection checks landed consistently around 3.6-4.2s, down
from the 20-30s+ failures seen earlier), and at 50-way concurrency the
idempotency test (Test 2) again passed completely - 10/10, zero 5xx. Test
1 improved too but still didn't reach a clean pass: at a *more*
realistic concurrency (10, matching this pilot's actual "<10 terminals"
target scale, rather than the deliberately extreme 50) exactly 2/10
sales succeeded, with the successful ones confirming zero lost updates
once again. The remaining failures were still `Unable to start a
transaction in the given time` even with the pool sized to exactly match
the concurrency (`connection_limit=10` against 10 simultaneous requests,
which should queue nobody) - the bottleneck is squarely each individual
*connection's* establishment cost, not pool contention. Three consecutive
identical connection-latency measurements landing in the same 3.6-4.2s
band (not still trending down) is itself informative: it reads less like
"Neon is mid-recovery from an incident" and more like this sandboxed
session's network path to Neon's `us-east-1` region simply running with
persistently elevated latency compared to a normal deployment - a
property of *this environment*, not something further waiting inside it
is likely to resolve.

**Where this leaves Test 1**: closed out as *not independently
achievable from within this session* rather than left as an open retry
loop. The load test already did the job it was built for - it found and
fixed five real defects, and its correctness assertions (no lost
updates, clean idempotency-race handling) have now passed repeatedly
across a wide range of latency conditions, which is itself strong
evidence the pool/timeout/transaction-logic fixes are sound. A clean raw-
throughput number is better obtained by re-running
`scripts/load-test-stock-decrement.mjs` from a normal deployment
environment (or against a differently-provisioned/warmer Neon compute)
than by continuing to retry from here.

Five real defects were found and fixed by this exercise:
`AuthService.pinLogin`'s missing transaction timeout, `connect_timeout`,
`pool_timeout`, `connection_limit`, and `maxWait` - plus the
idempotency-race 500 in `SalesService.create()`. `pnpm typecheck`, `pnpm
build`, `pnpm test`, and `pnpm lint` all pass clean for `apps/api`.

**Phase 3 — PCI review of the payment flow: done, and it found (and
fixed) a real, separate security gap.**

- **Scope determination first**: reviewed every payment-related file
  (`cash-payment.processor.ts`, `mpesa-payment.processor.ts`,
  `SalePayment` in `schema.prisma`, `SalesService.create()`'s payment
  handling) and confirmed **no cardholder data is processed, stored, or
  transmitted anywhere in this codebase**. `CARD` exists only as a
  `PaymentMethod` enum value; `SalesService.create()` explicitly rejects
  any non-`CASH` payment method with a 400 (M-Pesa is scaffolded but not
  wired in yet - see the Phase 1 sales-pipeline decision). `SalePayment`
  has no PAN/expiry/CVV columns, only `amount`, `method`, and an opaque
  `providerReference`. This means the app is currently **entirely out of
  PCI-DSS scope** for cardholder data - PCI-DSS governs payment card
  brand data specifically, and M-Pesa (mobile money, not a card scheme)
  isn't covered by it either. This scope determination is itself the most
  important output of the review: it's a documented, checkable claim
  ("grep for PAN/card columns, confirm zero"), not an assumption.
- **What this means for the future**: if/when `CARD` is ever wired in,
  the correct approach to stay out of PCI scope (SAQ A) is a hosted
  payment page or a P2PE terminal that never sends raw card data through
  this app's own backend at all - this codebase should never itself
  receive, log, or store a PAN. Documented here as the constraint for
  whoever builds that later, rather than left implicit.
- **Adjacent findings, reviewed as part of the same pass** (not
  cardholder data, but the same "how are payment/auth credentials
  handled" lens): `JWT_SECRET` is read via `getOrThrow` with no hardcoded
  fallback; passwords and PINs are bcrypt-hashed (`User.passwordHash`,
  `User.pinHash`); `.env` is confirmed gitignored and no secret has ever
  been committed (checked before every commit all session); the
  structured-logging redaction added earlier this phase already covers
  the `Authorization` header.
- **The one real gap the review found**: there was **no rate limiting
  anywhere in the app**. `POST /auth/pin-login` accepts a 4-8 digit PIN
  compared with bcrypt - a 4-digit PIN has only 10,000 possible values,
  and with zero throttling that's trivially brute-forceable against a
  shared terminal's PIN-switch endpoint. **Fixed**: added
  `@nestjs/throttler` globally (100 requests/minute/IP default, generous
  enough not to interfere with normal terminal traffic) with a much
  stricter override on `/auth/login` and `/auth/pin-login` specifically
  (5 attempts/minute/IP each, independent buckets) - the only two public,
  pre-JWT endpoints in the app.
- **Verified live**: 5 login attempts succeeded/failed normally
  (validation errors), the 6th+ within the same minute correctly returned
  `429 ThrottlerException`; `pin-login` was independently confirmed to
  have its own separate 5/minute bucket (not sharing `login`'s budget);
  the window was confirmed to reset after ~60s (a legitimate login that
  had been blocked succeeded again once the minute rolled over); and 15
  back-to-back authenticated requests to an ordinary endpoint
  (`GET /customers`) all returned `200`, confirming the generous global
  limit doesn't interfere with real usage. `pnpm typecheck`, `pnpm
  build`, `pnpm test`, and `pnpm lint` all pass clean for `apps/api`.

**Phase 3 — DR runbook: written and partially drilled live against the
real database.**

- New `DR_RUNBOOK.md` at the repo root: RPO/RTO targets sized for this
  pilot's stated scale, what actually protects the data today (Neon's own
  PITR + this repo being the source of truth for schema/RLS/roles, with
  an honest callout that `.env` secrets are *not* backed up by design),
  and four recovery scenarios (accidental bad write, total database loss,
  credential compromise, API-host-down-only) each with exact commands
  already used throughout this project.
- **Writing it surfaced a real, fixable gap**: `rls.sql`'s 28 `CREATE
  POLICY` statements were never idempotent, which is exactly why every
  new tenant-owned table added in earlier phases needed a hand-rolled
  temp-file workaround (see the Phase 2 stock-transfers/customers/
  layaways entries above) instead of just re-running the whole file. That
  workaround relies on remembering which tables are already covered -
  tribal knowledge that has no business surviving into an actual
  disaster-recovery restore. **Fixed**: every `CREATE POLICY` is now
  preceded by a matching `DROP POLICY IF EXISTS`, making the entire file
  safely re-runnable against any target - a fresh schema (the drops are
  harmless no-ops) or an already-provisioned one (no more naming
  collision).
- **Drilled live, not just written**: ran the newly-idempotent
  `rls.sql` against the actual pilot database (already fully set up, not
  a throwaway) and confirmed it completed with zero errors: This is the
  literal command the runbook's "total database loss" scenario calls for
  at its RLS step, exercised for real rather than only described.
  Re-verified afterward that isolation still held on every regular
  tenant-owned table (0 rows visible with no tenant context set) and that
  `org_users`' deliberate pre-auth exception still showed its intended
  2 rows rather than either 0 (broken login) or an unexpectedly wide
  leak - then smoke-tested the running API end-to-end (`GET /customers`
  with a real token) to confirm the re-apply didn't disturb anything
  live.
- **Honestly not drilled**: standing up a brand-new disposable Neon
  project end-to-end, an actual Neon point-in-time restore, and a
  branch-based recovery - each would need either a throwaway project or
  destructive action against the real pilot data, neither appropriate to
  do unprompted in this session. The individual commands those scenarios
  call for have each been run against a real database at least once
  during this project's build (every migration, the original `rls.sql`
  and `create-app-role.sql` setup), but a true continuous fire drill on a
  disposable project is the honest next step before relying on this
  runbook in a real incident - documented as such in the runbook itself
  rather than glossed over.
- `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass
  clean for `apps/api` (only `rls.sql` and documentation changed, no
  TypeScript touched, but the full suite was still run to confirm
  nothing else was disturbed).

**Phase 3 — Sync-conflict dashboard: done and verified end-to-end
against a live database.** Scoped deliberately as an API endpoint, not a
UI: no back-office frontend exists yet at all (only `apps/api` and
`apps/terminal-pwa`) - DESIGN.md marks a back-office app "Phase 2+" but
it was never scaffolded, and starting one is a much bigger scope increase
than this increment warrants. A future back-office app would consume
this endpoint once one exists.

- **Investigating the schema first found something worth knowing before
  building anything**: the two fields that look purpose-built for exactly
  this feature - `SyncOutbox` (a whole model: `PENDING`/`APPLIED`/`FAILED`)
  and `Sale.priceDriftFlagged` - are **completely dead**. Confirmed via
  grep across `apps/api/src`: nothing anywhere ever reads or writes
  either one. They were scaffolded early in the project but never wired
  up as the actual sync architecture took shape (the terminal PWA's own
  client-side Dexie outbox plus idempotent `POST /sales`, per DESIGN.md
  §6, turned out not to need a server-side mirror of sync state). Worth
  knowing before anyone builds on the assumption those fields are live.
- **What "sync conflict" concretely means here**, per DESIGN.md §6's
  stated philosophy ("never lose a sale, resolve stock conflicts after
  the fact"): a sale is always accepted even if it takes
  `InventoryItem.quantity` negative, rather than being rejected or
  blocking an offline terminal's sync. Negative quantity **is** the
  durable, queryable trace that a conflict happened and still needs a
  supervisor's manual reconciliation - so that's what the new endpoint
  surfaces, rather than inventing a new concept.
- New `GET /inventory/conflicts` (supervisor/manager/owner/auditor, same
  tier as the alert feed and ledger) returns every `InventoryItem` with
  negative quantity, each with its 10 most recent ledger entries inlined
  - a supervisor can see exactly what ran the count negative (concurrent
  sales at two terminals, a late-arriving offline sync, a bad manual
  adjustment) without a separate query per item.
- **Verified live**: with no conflicts present, the endpoint correctly
  returned an empty list; a real oversell was created (a manual `SALE`-
  type ledger entry taking quantity from 63 to -7, the same code path a
  genuine concurrent/offline oversell would hit) and the endpoint
  correctly surfaced it with the right quantity and 10 correctly-ordered
  recent transactions; reconciling it with a delivery-style `ADJUSTMENT`
  (-7 → 3) made it correctly disappear from the list, confirming the
  feed is live/self-resolving the same way the low-stock alert feed is; a
  cashier token got 403; and a raw query with no tenant context set
  confirmed 0 negative-quantity rows visible even while a real conflict
  existed at the time of the check (not just when the table was empty -
  RLS actually exercised under a non-trivial condition). `pnpm
  typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass clean
  for `apps/api`.

That closes out every remaining Phase 3 item except two: the load test's
raw-throughput number (closed out above as not independently achievable
from within this specific sandboxed session - re-run
`scripts/load-test-stock-decrement.mjs` from a normal deployment
environment for that number), and a full end-to-end DR fire drill on a
disposable Neon project.

## Phase 4 — Second vertical module (restaurant)

**Done: table/floor management, built as a genuine module against the
module contract, and verified end-to-end against a live database.**

### Prerequisite work: the module contract was scaffolded but non-functional

Before building anything restaurant-specific, investigating what "build
as a module" actually requires found that DESIGN.md §3's module contract
- `IndustryModuleManifest`, `ModuleRegistryService`, the four core domain
events (`sale.beforeComplete`, `sale.afterComplete`,
`inventory.beforeDecrement`, `refund.afterApproved`) - had existed since
Phase 0 but was **entirely non-functional**: a repo-wide grep confirmed
core never called `emit()` anywhere, so any module's declared hooks would
register but silently never fire. Separately, `packages/modules/retail`'s
README described Phase 1-2's discount/loyalty/layaway work as belonging
to a retail module package - it never did; all three were built directly
into core services (`SalesService`, `CustomersService`, `LayawaysService`)
because they're genuinely cross-vertical functionality, not
retail-specific. Both READMEs were corrected to state this plainly rather
than leave the contract's first real test looking already-proven when it
wasn't.

Fixed before writing any restaurant code:

- Wired real `emitAsync()` calls into `SalesService.create()`
  (`sale.beforeComplete` before the sale row is created - inside the
  transaction, so a listener that throws aborts it naturally;
  `sale.afterComplete` after the transaction commits, and only for a
  genuinely new sale, never an idempotent replay) and
  `InventoryTransactionsService.recordInTx()` (`inventory.beforeDecrement`,
  only for actual decrements). `refund.afterApproved` remains **not**
  wireable - there is no `RefundsService` at all yet, only the `Refund`
  Prisma model with no API to create one - documented as such rather than
  faked.
- Found and fixed a second, deeper bug while wiring the first: **module
  registration order was backwards**. `ModuleRegistryService`'s original
  design wired a manifest's hooks onto the event bus in its own
  `OnModuleInit`, looping over already-registered manifests - but a
  module normally calls `register()` from *its own* `OnModuleInit`, which
  Nest runs *after* its dependencies (including `ModuleRegistryService`)
  finish initializing. That meant the wiring pass would always run over
  an empty map before anything had a chance to register. Fixed by moving
  the event-bus wiring into `register()` itself, removing the dependency
  on init order entirely.
- `SalesService` was never exported from `SalesModule` - a pure DI gap
  TypeScript can't catch (it's a runtime resolution concern, not a type
  error), only caught by actually trying to inject it from a new module
  and running the app.

### The restaurant module itself

- **Packaging decision, stated plainly**: `packages/modules/restaurant`
  is intentionally an empty placeholder pointing at
  `apps/api/src/restaurant/` - a real, separately-compiled pnpm package
  (own `package.json`/`tsconfig.json`/build step, workspace-linked into
  `apps/api`) is real infrastructure investment that no other "module" in
  this codebase (Sales, Inventory, Layaways, Customers...) has ever
  needed, since they all live under `apps/api/src/*` as ordinary NestJS
  modules within the one deployable (DESIGN.md §1). What's enforced here
  is the *dependency direction* that actually matters - `restaurant/`
  imports `SalesService` freely; nothing in core imports from
  `restaurant/` - as a logical/code-review boundary, not a physical
  package boundary this codebase doesn't otherwise use.
- New `RestaurantTable` (branch, label, seats, status: `AVAILABLE` /
  `OCCUPIED` / `RESERVED` / `NEEDS_CLEANING`) and `RestaurantSaleTable`
  (a `transactionExtensions`-style 1:1 link table, per DESIGN.md §3,
  rather than a JSONB blob or a nullable column added to core's `Sale`
  model). A real Prisma limitation is documented plainly in the schema:
  there's no supported way to split one database's schema across
  multiple independently-migrated `schema.prisma` files, so a module's
  tables still live in the one shared schema file even though its *code*
  never touches core.
- `POST /restaurant/tables/:tableId/sales` is the module calling into
  core exactly as intended: it resolves the table, calls
  `SalesService.create()` directly (getting idempotency, discount/loyalty
  handling, inventory decrement, and audit logging for free, with zero
  duplicated logic), then creates the `RestaurantSaleTable` link and
  marks the table `NEEDS_CLEANING`. Not atomic across all three steps -
  documented as an accepted gap in the same "never lose a sale, reconcile
  after the fact" spirit as DESIGN.md §6's offline-sync philosophy: the
  sale itself is never at risk, only its cheap-to-reconcile table link.
- **A genuinely useful architectural finding surfaced by actually
  building and testing the hook, not just wiring it**: the first version
  of the `sale.afterComplete` hook tried to look up its own
  `RestaurantSaleTable` link to decide whether a given sale was
  restaurant-relevant - and always found nothing, because
  `RestaurantSalesService` creates that link *after* `SalesService.create()`
  (and its `afterComplete` emit) already returns. A hook cannot see
  synchronous extension data its own caller hasn't written yet. Fixed by
  having the hook not attempt that filtering at all - the lesson,
  documented in code: a module needing extension data to exist atomically
  alongside a sale has to write it directly as the caller (exactly what
  `RestaurantSalesService` already does), not lean on an `afterComplete`
  hook for it.
- **Verified live, end-to-end, against the real database**: created a
  table (`AVAILABLE` by default), confirmed a duplicate label at the same
  branch was rejected with 409; placed a real order via
  `POST /restaurant/tables/:id/sales` and confirmed the sale completed
  correctly, the table link was created, and the table flipped to
  `NEEDS_CLEANING`; confirmed the hook fired with the correct sale ID and
  wrote its own independent audit-log row (`restaurant.sale_hook_fired`)
  - proving a module-registered listener genuinely receives a real core
  event; confirmed the hook **also fires for a plain sale placed through
  the ordinary core `/sales` endpoint**, with no table involved at all -
  proving the mechanism is truly system-wide and core has zero awareness
  the restaurant module exists; confirmed an idempotent replay (same
  `clientId` submitted twice) produces exactly one hook fire, not two;
  confirmed RBAC (cashier blocked from creating tables, allowed to read
  the floor and place orders); and confirmed RLS holds on both new
  tables.
- **A methodology finding along the way, not an application bug**: an
  RLS check briefly appeared to fail (rows visible with no tenant
  context set) - tracked down to an earlier ad-hoc diagnostic script in
  this same session having used `set_config(..., false)` (session-level,
  not transaction-local), which leaked into a *different* script's
  connection via Neon's pooled-connection reuse. The real application
  code was never at risk (`TenantScopedPrismaService.run()` always uses
  `true`/transaction-local), but this cost real debugging time before
  being ruled out - documented in `apps/api/prisma/README.md` so a future
  ad-hoc check doesn't hit the same false alarm. Once ruled out, RLS was
  reconfirmed clean on both tables.
- Applying `rls.sql`'s two new policies for this phase used the plain
  `prisma db execute --file prisma/rls.sql` command directly against the
  live, already-provisioned database - no hand-rolled temp-file
  workaround needed, the first real payoff of the idempotency fix made
  during the DR-runbook work earlier in Phase 3.
- `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass
  clean for `apps/api`.

### Tips / service charge

**Done and verified live.** The second restaurant slice, chosen as the
simplest remaining piece since it only extends the existing order flow
rather than needing any new infrastructure like a KDS.

- New `RestaurantSaleTip` (another `transactionExtensions`-style 1:1
  link, per the same pattern as `RestaurantSaleTable`): `tipAmount`,
  `serviceChargeAmount`. Deliberately **not** folded into core's
  `Sale.total` or `SalePayment.amount` - core's total is what loyalty
  points are earned on (`SalesService.create()`'s
  `LOYALTY_EARN_RATE` math) and what shift cash-reconciliation sums
  (`ShiftsService`); mixing tip money into either would silently inflate
  both. A tip is collected as extra cash alongside the sale's own
  exact-total payment and tracked as parallel revenue the restaurant
  module reports on independently.
- `POST /restaurant/tables/:tableId/sales` now accepts optional
  `tipAmount`/`serviceChargeAmount`. Only creates a `RestaurantSaleTip`
  row when at least one is actually nonzero, so a plain order doesn't
  leave a pointless all-zero extension row behind. Idempotent the same
  way the table link already was: a retried submission with the same
  `clientId` returns the existing tip row rather than erroring or
  double-recording it.
- **Verified live**: an order with a 15 tip + 5 service charge on an
  80 KES item (92.80 with tax) correctly persisted both values on a
  separate `RestaurantSaleTip` row while `Sale.total` stayed exactly
  92.80, unaffected; a plain order with no tip correctly created no tip
  row at all (`tip: null` in the response); a negative `tipAmount` was
  rejected with 400 before ever touching the database; and a raw query
  with no tenant context set confirmed 0 rows visible on
  `restaurant_sale_tips` (RLS, applied via the plain `rls.sql` file
  directly again - no temp-file workaround needed). `pnpm typecheck`,
  `pnpm build`, `pnpm test`, and `pnpm lint` all pass clean for
  `apps/api`.

### Order-to-KDS routing and course timing

**Done and verified live - both remaining DESIGN.md Phase 4 items in one
increment, since course timing has no meaning without KDS routing to
attach it to.**

- New `KitchenStation` (a prep area - "Grill", "Bar", "Cold";
  `entityExtensions`, a first-class entity this module owns outright) and
  `KitchenTicket`/`KitchenTicketLine` - one ticket per **(sale, station,
  course)**, so the kitchen sees one focused ticket per prep area rather
  than a single ticket spanning stations that don't coordinate (a grill
  cook doesn't need to see the dessert line, and vice versa).
- `TableOrderLineItemDto` (this module's own richer line-item shape -
  `variantId`/`quantity` plus `stationId`/`courseNumber`/`notes`) is kept
  deliberately separate from core's plain `SaleLineItemInputDto` rather
  than adding these fields there - an ordinary retail sale has no
  stations or courses, so core's DTO shouldn't carry fields only this
  vertical uses. `RestaurantSalesService` derives core's plain
  `lineItems` array from it before calling `SalesService.create()`.
- **Course timing, concretely**: course 1 (or unspecified) tickets are
  created `QUEUED` and reach the kitchen immediately; any higher course
  is created `HELD` and stays invisible to a station's normal ticket
  queue until `POST /restaurant/sales/:saleId/courses/:courseNumber/fire`
  transitions every `HELD` ticket for that course to `QUEUED` at once -
  e.g. firing dessert only once mains are cleared. Firing an
  already-fired (or nonexistent) course is a no-op, not an error, the
  same idempotent-by-default posture used for sale submission elsewhere.
- **Ticket lifecycle is strictly forward-only**:
  `QUEUED -> IN_PROGRESS -> READY -> SERVED` via
  `PATCH /restaurant/kitchen-tickets/:id/advance`, one stage at a time -
  no skipping ahead, no going back, and a `HELD` ticket cannot be
  advanced directly at all (must be fired first). Each transition
  stamps its own timestamp (`startedAt`/`readyAt`/`servedAt`).
- **A real bug found and fixed by actually testing the failure path, not
  just the happy path**: the first version validated `stationId`s only
  while creating tickets, *after* `SalesService.create()` had already
  committed - an order with a typo'd `stationId` produced a 404 to the
  client while the sale had already completed, decremented stock, and
  charged the customer, with **zero kitchen tickets ever created for
  it**: a paid-for order that would never reach the kitchen. Live-tested
  this exact scenario, confirmed stock had moved despite the "failed"
  response, then fixed it by moving station validation to run *before*
  `SalesService.create()` is ever called (`KitchenTicketsService
  .assertStationsExist()`), re-tested the identical scenario, and
  confirmed stock now correctly stays untouched when the request is
  rejected.
- **Verified live end-to-end** against the real database: two stations
  created (duplicate name at the same branch correctly rejected with
  409); a two-course order (2x Grill item on course 1, 1x Dessert item on
  course 2) correctly produced one `QUEUED` ticket (with the line's
  `notes` preserved) and one `HELD` ticket; the KDS queue filtered by
  station+status correctly showed the Grill ticket under `QUEUED` and
  correctly excluded the still-`HELD` Dessert ticket; attempting to
  advance the `HELD` ticket directly was correctly rejected with a
  message pointing at the fire-course endpoint instead; the Grill ticket
  was walked through its full `QUEUED -> IN_PROGRESS -> READY -> SERVED`
  lifecycle with each transition's timestamp correctly stamped, and a
  further advance attempt on the now-`SERVED` ticket was correctly
  rejected; firing course 2 correctly moved the Dessert ticket to
  `QUEUED` (now visible in that station's queue) and firing it again was
  a correct no-op; the unknown-station bug above was reproduced, fixed,
  and re-verified live; RBAC (cashier blocked from creating stations,
  allowed to view the KDS queue); and RLS confirmed clean on all three
  new tables. `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm
  lint` all pass clean for `apps/api`.

This closes out DESIGN.md's full Phase 4 restaurant scope: table/floor
management, tips/service charge, and order-to-KDS routing with course
timing.

## Core: refunds (completing the module contract's fourth event)

**Done and verified live.** With Phase 4 finished, picked up a loose end
noted since the Phase 3 event-hook hardening: `refund.afterApproved` -
the fourth core domain event declared in the manifest since Phase 0 -
was still unwireable because no `RefundsService` existed anywhere; only
the `Refund` Prisma model sat unused, the same "dead schema" pattern
already found and fixed for `SyncOutbox`/`priceDriftFlagged` (Phase 4's
restaurant write-up) and `InventoryItem.lowStockThreshold` (Phase 2).

- `SalesService.refund()` + `POST /sales/:id/refunds`. Deliberately a
  **monetary-only** refund, not a goods return: the `Refund` model has no
  line-item reference (unlike `void()`, which reverses every line's
  inventory), so this is scoped to what it actually models - money given
  back for a pricing mistake, a complaint, or a goodwill gesture, kept
  distinct from `void`'s "this sale never happened, take the stock back."
  A refund that also needs goods returned should void the sale instead;
  this endpoint intentionally never touches inventory.
- Multiple partial refunds against the same sale are allowed, capped at
  the sale's total combined across all of them. The approver is
  re-verified against the database on every refund, never trusted from
  the client - same reasoning, and the same `SUPERVISOR_OR_ABOVE` role
  check, as a sale's discount approver. The endpoint itself isn't
  role-gated at the controller level (a cashier can submit the request);
  it's the named approver's actual role that's checked, so the request
  reaching the endpoint proves nothing on its own.
- `refund.afterApproved` fires after the transaction commits, same
  reasoning as `sale.afterComplete` (a slow hook shouldn't hold the
  transaction open). Wired a second real subscriber in
  `RestaurantHooksService` (a plausible restaurant use - flagging a
  comped/returned item) specifically to prove live, not just assume,
  that this event fires the same way the others do.
- **Verified live** against the real database: a refund approved by a
  cashier's own id was rejected with 400 before touching the database; a
  refund exceeding the sale's total was rejected with the exact remaining
  balance shown; a 100 partial refund against a 185.60 sale left `total`
  correctly unchanged at 185.60 (refunds don't edit the sale, they record
  against it); a second refund correctly computed the remaining balance
  (85.60) and rejected an over-limit attempt with the precise numbers; the
  exact remaining balance succeeded, fully exhausting it; a third refund
  attempt on the now-fully-refunded sale was rejected; refunding an
  already-voided sale was rejected; the inventory ledger for the refunded
  sale showed no additional movement beyond the original `SALE` entry,
  confirming the refund never touched stock; the hook fired for both real
  refunds with the correct refund/sale IDs; a cashier-submitted request
  correctly returned a balance-based 400 (not a 403), confirming the
  endpoint itself isn't role-gated; and a raw no-tenant-context query
  confirmed 0 rows visible on `refunds` even with real refund rows now
  present (RLS, already in place since Phase 0 - `refunds` had simply
  never been exercised before). `pnpm typecheck`, `pnpm build`, `pnpm
  test`, and `pnpm lint` all pass clean for `apps/api`.

## Phase 5 — Third vertical (pharmacy)

**First slice done and verified live: batch/expiry enforcement.**
Deliberately scoped tight, per DESIGN.md's own framing of Phase 5
("batches table already exists in core — pharmacy module adds
enforcement rules + prescription linkage on top") - this slice is the
enforcement half only; prescription linkage and controlled-substance
flags are left for a later increment, the same one-slice-at-a-time
discipline used throughout every phase before this one.

- **Two core completions first**, since batch/expiry tracking is
  explicitly "a core capability... not pharmacy-exclusive" per the
  `Batch` model's own schema comment (dating to Phase 1), but it had no
  API surface at all: `POST/GET /inventory/batches` (receiving a batch
  always creates its corresponding inventory increment in the same
  operation, through the same `recordInTx` ledger path every other stock
  movement uses - a batch record with no matching stock movement would be
  a paper trail for goods never actually added), and a new
  `SaleLineItem.batchId` column (nullable) so a sale can record which
  batch a line was actually drawn from - previously only the ledger
  (`InventoryTransaction.batchId`) captured this, not the sale's own line
  items.
- `PharmacyModule` (`apps/api/src/pharmacy/`) has no schema of its own
  for this slice - its entire job is a `inventory.beforeDecrement` hook
  (the same veto mechanism proven in Phase 4's restaurant hooks) that
  blocks dispensing from an expired batch. Deliberately scoped to
  `PHARMACY`-industryType organizations only, not "any org with an
  expired batch": a retail tenant selling near-expiry cosmetics at a
  discount is a legitimate call this module has no business overriding -
  DESIGN.md frames this as pharmacy *policy* layered on generic core
  data, not a universal rule core itself should enforce.
- **Verified live** against the real database: created a batch expiring
  30 days out and one that already expired 30 days ago, both correctly
  incrementing stock by their received quantity; sold from the expired
  batch while the demo org's `industryType` was still `RETAIL` and
  confirmed it succeeded (proving the enforcement really is
  pharmacy-scoped, not universal) with the sale's line item correctly
  recording the `batchId`; switched the org to `PHARMACY` (via a raw
  script, reverted back to `RETAIL` afterward to keep the rest of the
  demo data consistent with every earlier phase) and confirmed the
  identical sale was now blocked with a precise message naming the batch
  and its expiry date; confirmed stock stayed completely untouched by the
  blocked attempt (the whole sale transaction rolled back cleanly, not a
  partial write); confirmed a non-expired batch and a plain batchless
  sale both still succeeded under `PHARMACY`; RBAC (cashier blocked from
  creating batches, allowed to view them); and RLS confirmed clean on
  both `batches` and `sale_line_items`. `pnpm typecheck`, `pnpm build`,
  `pnpm test`, and `pnpm lint` all pass clean for `apps/api`.

### Controlled-substance flags and prescription linkage

**Done and verified live - this closes out DESIGN.md's full Phase 5
pharmacy scope** (batch/expiry enforcement + these two).

- New `PharmacyProductFlag` (`isControlledSubstance`, a free-text
  `schedule` classification) - unlike `Batch`, this is a genuinely
  pharmacy-owned `entityExtensions` table, not a core capability: whether
  a product is a controlled substance is pharmacy-specific policy core's
  catalog has no business knowing about. `PATCH/GET
  /pharmacy/products/:productId/controlled-substance` (supervisor+ to
  set, any role to read - same tier as the restaurant module's
  table/station management).
- New `PharmacySalePrescription` (`transactionExtensions`, the same 1:1
  link pattern as `RestaurantSaleTable`/`RestaurantSaleTip`) plus `POST
  /pharmacy/sales`. **Applied Phase 4's own lesson directly**: a
  controlled-substance line's prescription requirement is validated
  *before* `SalesService.create()` is ever called, not checked
  afterward via a hook - a hook can't retroactively stop a sale that's
  already committed, and (per the restaurant module's documented
  finding) can't reliably see this module's own extension data at fire
  time either. Same fix shape as the restaurant module's station
  validation bug from Phase 4, applied proactively this time instead of
  needing to be caught by testing the failure path first.
- **Verified live** against the real database: flagged the demo product
  as a controlled substance; a sale of it with no prescription was
  correctly rejected with 400 (naming the product) *before* touching
  core, and stock was confirmed completely untouched by the blocked
  attempt; the identical sale with a valid prescription succeeded, with
  the prescription correctly linked to the new sale; unflagging the
  product (upsert, not a duplicate row) let the same item sell with no
  prescription required; RBAC (cashier blocked from setting the flag,
  allowed to read it); and RLS confirmed clean on both new tables. `pnpm
  typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass clean
  for `apps/api`.

That's the full Phase 5 pharmacy vertical.

## Phase 5+ — Fourth vertical (salon)

**First slice done and verified live: appointment/resource scheduling
with double-booking prevention.**

- New `SalonResource` (a bookable resource - a stylist, a chair, a room;
  whatever the branch actually needs to schedule against) and
  `SalonAppointment` (`serviceName` as free text for this slice rather
  than linked to a core `Product` - a real service-catalog integration
  feeding pricing into a checkout sale is the natural next slice, not
  folded into this one). Deliberately **no** `transactionExtensions` or
  hooks into core for this slice: unlike restaurant/pharmacy, booking an
  appointment doesn't need to touch `SalesService` at all - linking a
  completed appointment to checkout is the follow-up, the same
  incremental discipline used throughout every phase before this one.
- The actual "resource scheduling" value this module exists for: two
  appointments for the same resource with overlapping time ranges are
  rejected outright (`startTime < existing.endTime AND endTime >
  existing.startTime`, the standard interval-overlap test), not left for
  a human to notice at checkout. A cancelled or no-show appointment
  doesn't block the slot it was going to occupy - the resource is
  genuinely free again once an appointment is no longer actually
  happening.
- Status lifecycle is a branching state machine, not the restaurant
  module's strict single-path sequence: `SCHEDULED`/`CONFIRMED` can each
  move to `CANCELLED` or `NO_SHOW` in addition to advancing forward
  (`SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED`); `COMPLETED`,
  `CANCELLED`, and `NO_SHOW` are all terminal.
- **Verified live** against the real database: created a resource,
  confirmed a duplicate name at the same branch was rejected with 409;
  booked a 10:00-11:00 appointment, confirmed an overlapping 10:30-11:30
  attempt was rejected with a precise message naming the resource and its
  existing booking window; confirmed a genuinely adjacent 11:00-12:00
  booking succeeded (back-to-back is fine, only actual overlap is
  rejected); confirmed `endTime <= startTime` was rejected before
  touching the database; walked an appointment through
  `SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED` with each step
  correctly accepted, confirmed skipping straight to `COMPLETED` from
  `SCHEDULED` was rejected, and confirmed no transition out of the
  now-`COMPLETED` appointment was allowed; booked and then cancelled a
  separate appointment, then confirmed the identical slot could be
  rebooked (cancelled genuinely frees the resource); RBAC (cashier
  blocked from creating resources, allowed to book/manage appointments -
  a routine front-desk operation); and RLS confirmed clean on both new
  tables. `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint`
  all pass clean for `apps/api`.

Still to do for this vertical: linking a completed appointment to a
checkout sale (the same "module calls into core" pattern already proven
twice, in restaurant and pharmacy) - DESIGN.md's Phase 5+ scope doesn't
call for anything beyond scheduling itself, but a service business
realistically wants the appointment's price to become the checkout total.

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
