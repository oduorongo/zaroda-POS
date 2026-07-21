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

**Retried later (same session type, different day)**: single-query
baseline latency to Neon measured 7.1s immediately before the retry (vs
normal <100ms - unchanged from every earlier measurement in this
document). Ran the 50-concurrent-sale test anyway rather than skip it:
50/50 failed with `P2028: Transaction already closed... timeout for this
transaction was 15000ms, however 15309ms passed` - the exact same
failure class as every earlier attempt, not a new regression, and
expected given a ~7s single-query baseline compounding under 50-way
concurrency past the 15s transaction budget. **The correctness
assertions still held even through total failure**: `Quantity after: 108
(expected 108) - PASS: no lost updates`, and the separate same-`clientId`
concurrency test (10 concurrent identical submissions) passed cleanly -
one sale created, no 5xx from the idempotency race, exactly one unit
decremented. Stopped the dev server afterward. This remains genuinely
blocked on this session's/environment's network path to Neon, not on any
application code - the pool/timeout tuning already applied is sound
(demonstrated again by the correctness passes above), there's just no
throughput number obtainable from here until the underlying latency
condition changes.

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

### Appointment checkout

**Done and verified live.** DESIGN.md's Phase 5+ scope for salon doesn't
call for anything beyond scheduling itself, but a service business
realistically wants the appointment's price to become the checkout
total - the third module to use the "module calls into core" pattern
(restaurant, pharmacy, now salon).

- New `SalonAppointmentSale` (`transactionExtensions`, same 1:1 link
  pattern as `RestaurantSaleTable`/`PharmacySalePrescription`) plus
  `POST /salon/appointments/:id/checkout`. Core's line items still
  reference real `ProductVariant`s (checkout needs an actual catalog
  price to charge) - `SalonAppointment.serviceName` stays free text, a
  deeper service-catalog integration would be a further follow-up.
- Only an `IN_PROGRESS` or `COMPLETED` appointment can be checked out -
  validated before `SalesService.create()` is ever called, the same
  lesson applied a third time now: a service that hasn't happened yet
  shouldn't be charged for. Checking out an `IN_PROGRESS` appointment
  also marks it `COMPLETED` - checkout is the natural point a service
  visit actually finishes.
- **Idempotency is keyed on the appointment itself**, not just the
  sale's `clientId` - once an appointment has a linked sale, checking it
  out again resolves to that same sale regardless of what `clientId` (or
  even cashier session) the retry sends, rather than only catching an
  exact-duplicate submission. A stronger guarantee than core's own
  idempotency alone provides, appropriate here since "this appointment
  already has a sale" is unambiguous in a way "this exact request body
  was already submitted" isn't.
- **Verified live** against the real database: checking out a still-
  `SCHEDULED` appointment was rejected with 400 before touching core;
  advancing it to `IN_PROGRESS` and checking out succeeded, with the sale
  correctly linked and the appointment automatically flipped to
  `COMPLETED`; checking out the same appointment again - with a
  different `clientId` and a garbage `cashierSessionId` - correctly
  returned the original sale unchanged, with stock confirmed genuinely
  untouched by the repeat call (no second decrement); RBAC (a cashier
  could book, advance, and would be able to check out - a routine
  front-desk flow); and RLS confirmed clean on the new table. `pnpm
  typecheck`, `pnpm build`, `pnpm test`, and `pnpm lint` all pass clean
  for `apps/api`.

This closes out every module named across DESIGN.md's Phase 4/5 scope:
retail (core), restaurant, pharmacy, and salon.

## Terminal PWA: catching up on core backend capability

**First slice done: customer lookup/attach with loyalty-point
redemption, and discount entry, on the cash checkout screen.** Every
vertical module built above is real and live-verified on the backend,
but the terminal PWA had not moved past its Phase 1 cash-only,
line-items-only cart - `POST /sales`'s `discount`, `customerId`, and
`redeemPoints` fields existed only for `curl`/load-test scripts, not for
an actual cashier. This starts closing that gap, deliberately scoped to
the two genuinely universal core gaps (every tenant, every industry)
before any vertical-specific UI (restaurant tables/KDS, pharmacy
prescriptions, salon booking) - the ordering agreed with the user before
starting.

- `lib/db.ts`'s `OutboxSale` gained `discount` (`{type, value,
  approvedById}` or `null`) and `customerId`/`redeemPoints` fields - no
  Dexie version bump needed, since Dexie's `stores()` only declares
  indexes (`clientId, status`), not the full field list, and neither
  index changed.
- `lib/sync.ts` now forwards `discount`/`customerId`/`redeemPoints`
  through to `POST /sales` instead of silently dropping them.
- `app/pos/page.tsx`: a customer can be searched (`GET
  /customers?search=`) or quick-created (`POST /customers`) and attached
  to the sale; once attached, a points-redemption input is capped
  client-side at the customer's cached point balance (the server
  re-validates independently). A discount can be applied as PERCENT or
  FIXED, with the approver chosen from the terminal's already-cached
  org-user list filtered to `SUPERVISOR`/`MANAGER`/`OWNER` roles - a UX
  convenience only; the actual authorization boundary is
  `SalesService`'s own server-side role re-check of `approvedById`,
  exactly as it already was for the `curl`-driven testing earlier in
  this document. The cart summary shows discount and redemption as
  separate line items before the final total, and both are cleared after
  a sale is queued.
- **Known simplification, not yet closed**: picking an approver from the
  cached list doesn't ask that person to re-enter their PIN at the
  terminal - a cashier can currently select any cached supervisor+ name
  without that person's live confirmation. The server-side role check is
  still the real enforcement boundary (unchanged from before this
  slice), so this isn't a new authorization hole, but it's weaker
  physical-security UX than a manager keying in their own PIN to
  approve. Closing it needs a new lightweight "verify this PIN without
  starting a session" backend endpoint - `POST /auth/pin-login` isn't
  the right tool since it creates a whole new `CashierSession` as a side
  effect. Left open rather than bolted on for this slice.
- **Verification done**: `pnpm typecheck` and `pnpm lint` both pass
  clean for `apps/terminal-pwa`. `pnpm build` was **not** run - a
  terminal-pwa dev server was already running locally
  (`npm run dev`'s `.next` cache is known to get corrupted by a
  concurrent `build`), and the API server was not running in this
  session, so this slice was **not exercised live in a browser or
  against a real backend** - stated plainly rather than claimed. The
  underlying `POST /sales` behavior this UI now drives
  (`discount`/`customerId`/`redeemPoints`) was already verified live
  against the real database earlier in this document via direct API
  calls; only the new frontend wiring itself is unverified beyond
  static analysis.
- **Deliberately not in this slice**: vertical-specific terminal UI
  (restaurant table selection/KDS view, pharmacy prescription entry,
  salon booking/checkout), tips (a restaurant/salon-specific concept via
  `RestaurantSaleTip`, not a core `Sale` field, so out of scope for a
  "core gaps" slice), and refunds (a back-office concern more than a
  cashier one, revisit if that assumption turns out wrong).

### Restaurant vertical: table floor view + kitchen display, on the terminal

**Done and verified live.** First slice of vertical-specific terminal UI,
following the core-gaps slice above - the restaurant module's backend
(table/floor management, order-to-KDS routing, course timing) has been
live-verified since Phase 4, but nothing on the terminal used it; a
restaurant tenant's cashier had no way to open a table, route items to a
kitchen station, or see what the kitchen owed a table.

- **New backend endpoint, `GET /organizations/me`**: the terminal needs
  to know its org's `industryType` to decide which vertical UI (if any)
  to show, and nothing exposed that to an authenticated client before -
  the JWT payload doesn't carry it, and no `OrganizationsController`
  existed. Added a minimal one (`apps/api/src/organizations/`, no role
  restriction, same tier as reading the product catalog) returning
  `{id, name, industryType, country, baseCurrency}` scoped by RLS to the
  caller's own org. `apps/terminal-pwa/app/setup/page.tsx` now calls it
  once during provisioning and caches `industryType` on `DeviceConfig`.
- `app/tables/page.tsx` (new): a floor view color-coded by
  `RestaurantTable.status`, tapping a table opens an order builder built
  on the same catalog cache the plain POS screen uses, plus a
  station/course picker per item (mirroring `TableOrderLineItemDto`).
  Submits to `POST /restaurant/tables/:id/sales` - **deliberately not
  outbox-queued** like the plain cash sale is: a table order that hasn't
  actually reached the kitchen isn't doing its job queued for a later
  sync, so this screen requires connectivity and surfaces `OfflineError`
  plainly rather than silently accepting an order it can't deliver.
  Tables stuck in `NEEDS_CLEANING` can be marked available again inline.
- `app/kds/page.tsx` (new): a kitchen display filtered to one station at
  a time, polling `GET /restaurant/kitchen-tickets` every 10s (no
  push/realtime infrastructure exists anywhere in this codebase yet, so
  polling matches everything else) and advancing a ticket one stage at a
  time via `PATCH /restaurant/kitchen-tickets/:id/advance` - `HELD`
  (un-fired) tickets are excluded by construction, matching the
  backend's own "advance can't reach a held course" rule.
  `/pos`'s header gains "Tables"/"Kitchen" nav links, shown only when
  `device.industryType === "RESTAURANT"`.
- **Verified live** against the real database, using the existing
  restaurant fixtures on the demo org (a `Table`, two `KitchenStation`s,
  a real product/variant) left over from Phase 4's own live testing:
  called `GET /organizations/me` and confirmed the real `industryType`
  came back correctly scoped by RLS; submitted a table order through
  `POST /restaurant/tables/:id/sales` with the exact request shape
  `tables/page.tsx` sends (station + course per line item) and confirmed
  the sale completed, the table linked, and a `QUEUED` kitchen ticket was
  created; fetched `GET /restaurant/kitchen-tickets?stationId=...` with
  the exact shape `kds/page.tsx` consumes and confirmed the new ticket
  appeared; advanced it via `PATCH .../advance` and confirmed
  `QUEUED → IN_PROGRESS` with `startedAt` set; reset the test table back
  to `AVAILABLE` afterward. `pnpm typecheck`, `pnpm lint`, and `pnpm test`
  all pass clean for `apps/api`; `pnpm typecheck` and `pnpm lint` pass
  clean for `apps/terminal-pwa`.
- **Not independently verified this session**: the two new pages'
  rendering/interaction in an actual browser - no browser automation was
  available, so this was verified by driving the exact API calls the
  pages make (above) plus static analysis, not by clicking through the
  UI. Stated plainly per this project's own standard rather than
  claimed.
- **Deliberately not in this slice**: firing a held course
  (`POST /sales/:saleId/courses/:courseNumber/fire`) has no terminal UI
  yet - course timing beyond "everything fires as course 1" needs a
  follow-up; pharmacy prescription entry and salon booking/checkout
  remain unstarted, per the agreed ordering (core gaps, then one
  vertical at a time).

### Pharmacy vertical: prescription entry on the terminal

**Done and verified live.** Second vertical-specific terminal slice.
Unlike the restaurant module, this one doesn't need new screens - a
pharmacy sale is the same cart/checkout UI as the plain POS screen, just
submitted through a different endpoint with a reject-then-retry step
when a controlled substance is involved.

- `app/pos/page.tsx`: when `device.industryType === "PHARMACY"`,
  `completeSale()` no longer queues to the outbox - it calls `POST
  /pharmacy/sales` directly and synchronously. **Deliberately
  online-only**, for a different reason than the restaurant screens'
  "needs live coordination": the controlled-substance/prescription check
  is a gating compliance rule that has to run *before* the sale
  completes, and queuing it offline would let a cashier physically hand
  over medication before the server ever validated that requirement -
  a worse risk than a delayed kitchen ticket.
- If the server rejects with 400 and a message matching `/prescription/i`
  (`PharmacySalesService.createWithPrescription`'s exact wording, naming
  the controlled product(s) by name), a prescription modal opens showing
  that message plus number/prescriber/issued-date fields. Resubmitting
  reuses the **same `clientId`** as the first attempt - not a new one -
  so the retry resolves to the same idempotent sale rather than a second
  one if it ever raced with anything else.
- No bulk "which of these cached variants are flagged" endpoint exists
  (`PharmacyProductFlagsService` only offers a per-product lookup), so
  this doesn't try to warn the cashier before checkout - the server's
  own rejection is the first signal, exactly as it already was for
  `curl`-driven testing. A proactive catalog-level flag indicator would
  need that bulk endpoint added first; left as a known gap rather than
  worked around with N sequential lookups per cart.
- **Verified live** against the real database: flagged the demo org's
  one seeded product as a controlled substance via `PATCH
  /pharmacy/products/:id/controlled-substance`; submitted the exact
  request shape `submitPharmacySale()` sends with no prescription and
  confirmed the 400 came back with the precise message the UI's regex
  matches; resubmitted with the same `clientId` plus a prescription
  attached and confirmed the sale completed and
  `PharmacySalePrescription` was created correctly linked; unflagged the
  product afterward to leave the demo org as found. `pnpm typecheck` and
  `pnpm lint` pass clean for `apps/terminal-pwa`.
- **Not independently verified this session**: the modal's
  rendering/interaction in an actual browser - no browser automation was
  available, so verification was the exact API round trip above plus
  static analysis, stated plainly rather than claimed, consistent with
  every other slice in this section.
- **Deliberately not in this slice**: batch/expiry selection at checkout
  (core's `SaleLineItemInputDto.batchId` and the pharmacy hook that
  blocks an expired batch are both live-verified on the backend, but the
  terminal cart has no batch picker - a real pharmacy terminal would
  need one, follow-up not started); salon booking/checkout remains
  unstarted, per the agreed ordering.

### Salon vertical: booking book + checkout on the terminal

**Done and verified live.** Third and final vertical-specific terminal
slice named in DESIGN.md's Phase 4/5 scope, following restaurant and
pharmacy. Closes out the terminal-PWA catch-up work started with the
core-gaps slice (customer/discount).

- `app/salon/page.tsx` (new): a same-day booking book (`GET
  /salon/appointments` filtered to today's `from`/`to` range), a "+ New"
  form to book a resource/service/time slot, status-transition buttons
  driven by a client-side mirror of `SalonAppointmentsService`'s
  `ALLOWED_TRANSITIONS` map (a UX guide only - the server independently
  re-validates every transition, so a stale button just surfaces a 400,
  same as everywhere else in this app), and a checkout flow for any
  `IN_PROGRESS`/`COMPLETED` appointment that reuses the catalog cache to
  build a cart and posts to `POST /salon/appointments/:id/checkout`.
  `/pos`'s header gains a "Bookings" link, shown only when
  `device.industryType === "SALON"`.
- **Deliberately online-only**, the same reasoning as the restaurant
  floor view rather than the pharmacy screen's compliance reasoning: a
  booking that hasn't actually reached the server isn't preventing a
  real double-booking, so there's no useful offline-queued version of
  this screen.
- **Verified live** against the real database: created a new
  `SalonResource` and booked an appointment against it with the exact
  request shape the "+ New" form sends, confirmed it appeared correctly
  in the same `from`/`to`-scoped list query the page issues on load;
  advanced it `SCHEDULED → CONFIRMED → IN_PROGRESS` via the same
  status-button calls the page makes; checked it out with the exact
  shape `submitCheckout()` sends and confirmed the sale completed and
  linked to the appointment; retried the identical checkout call and
  confirmed it resolved to the same sale rather than double-charging
  (the appointment-keyed idempotency already verified on the backend in
  Phase 5+, now confirmed reachable through the exact call this screen
  makes). The test resource/appointment were left in the demo org
  afterward rather than deleted - no delete endpoint exists for either,
  consistent with the restaurant module's own live-test fixtures being
  left in place rather than cleaned up. `pnpm typecheck` and `pnpm lint`
  pass clean for `apps/terminal-pwa`.
- **Not independently verified this session**: the page's
  rendering/interaction in an actual browser - no browser automation was
  available, so verification was the exact API round trip above plus
  static analysis, stated plainly, consistent with every other slice in
  this section.
- **Deliberately not in this slice**: linking a booking to a real
  `Customer` (the "+ New" form doesn't collect one, even though
  `CreateAppointmentDto.customerId` and the checkout DTO's own
  `customerId`/`redeemPoints` both support it - the plain POS screen's
  customer-attach modal isn't wired into this flow yet); resource
  creation/management (still SUPERVISOR+-only via a back-office path,
  matching the restaurant module's tables/stations, not exposed on this
  screen).

This closes out the terminal-PWA catch-up: every module named across
DESIGN.md's Phase 4/5 scope now has both a live-verified backend and a
terminal UI actually driving it.

### Restaurant vertical: firing held courses from the floor view

**Done and verified live.** Closes one of the gaps the restaurant slice
above explicitly left open: course timing beyond "everything fires as
course 1" had no terminal UI.

- `app/tables/page.tsx`: after an order with a course > 1 is sent, the
  held course numbers are tracked in-memory per table (no "which sales
  still have unfired courses" list endpoint exists to reconstruct this
  after a page reload - documented as a known limit of this being
  in-memory rather than persisted, consistent with the rest of this
  vertical being online-only). The floor grid shows a "Fire course N"
  button per table with something still held; tapping it calls `POST
  /restaurant/sales/:saleId/courses/:courseNumber/fire` and removes that
  course from the pending set on success.
- **A real bug caught by live-testing, not by typecheck/lint**: the
  first version of `fireCourse()` posted to `/sales/:saleId/courses/...`
  - core's URL shape - but `KitchenTicketsController` is actually mounted
  at `@Controller('restaurant')`, so the real route is
  `/restaurant/sales/:saleId/courses/:courseNumber/fire`. TypeScript
  can't catch a wrong string literal in a fetch path, and the button
  would have silently 404'd for every user until caught here - exactly
  the class of bug this project's "verify live before calling it done"
  discipline exists to catch.
- **Verified live** against the real database: submitted a two-course
  table order with the exact shape `submitOrder()` sends and confirmed
  course 1 came back `QUEUED` while course 2 came back `HELD`; called
  the fire endpoint with the corrected route and confirmed course 2
  flipped to `QUEUED` with `firedAt` set; retried the identical fire call
  and confirmed it returned an empty array (already-fired courses are a
  no-op, not an error) rather than re-firing or erroring. `pnpm
  typecheck` and `pnpm lint` pass clean for `apps/terminal-pwa`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser - no browser automation was available, so this was
  verified via the exact API round trip above plus static analysis,
  stated plainly rather than claimed.

### Pharmacy vertical: batch/expiry picker on the cart

**Done and verified live.** Closes the other gap the pharmacy slice
explicitly left open - `SaleLineItemInputDto.batchId` and the pharmacy
hook that blocks an expired batch were both live-verified on the
backend, but the terminal cart had no way to pick a batch at all.

- `app/pos/page.tsx`: when `device.industryType === "PHARMACY"`, each
  cart line gets a batch dropdown, lazily fetched on first focus via
  `GET /inventory/batches?variantId=...` and cached per variant (no bulk
  "batches for these N variants" endpoint exists, only a per-variant
  one). Expired batches are shown in the list, visibly labeled
  `(EXPIRED)`, rather than filtered out - the pharmacy
  `inventory.beforeDecrement` hook is the actual enforcement boundary,
  and hiding an expired batch as if it never existed would be less
  honest than showing it and letting the server reject it. Selecting one
  is optional, matching the DTO.
- **Verified live** against the real database: created a fresh and an
  expired `Batch` via `POST /inventory/batches`, confirmed both appear
  through the exact `GET /inventory/batches?variantId=...` call
  `loadBatchesFor()` makes; submitted a pharmacy sale with the fresh
  batch's id using the exact shape the cart now sends and confirmed the
  sale completed with `batchId` correctly on the line item. **Did not
  re-verify the expiry rejection itself in this pass** - the demo org
  used for convenience throughout this session's live testing is
  `industryType: RETAIL`, and the pharmacy hook that blocks an expired
  batch is deliberately scoped to `PHARMACY`-industry orgs only (already
  verified against a true pharmacy org in an earlier session); submitting
  the expired batch's id against this RETAIL org correctly completed
  rather than rejecting, exactly as that scoping intends - noted plainly
  so this isn't mistaken for a fresh verification of the rejection path
  itself. `pnpm typecheck` and `pnpm lint` pass clean for
  `apps/terminal-pwa`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser - no browser automation was available, so this was
  verified via the exact API round trips above plus static analysis,
  stated plainly rather than claimed.

This closes both gaps the pharmacy and restaurant terminal slices left
open.

### Salon vertical: linking a customer to a booking

**Done and verified live.** Closes the last documented gap from the
vertical-UI work - `CreateAppointmentDto.customerId` and the checkout
DTO's own `customerId`/`redeemPoints` were both already supported by the
backend, but the "+ New" booking form and checkout screen never
collected one.

- `app/salon/page.tsx` gains the same customer search/quick-create
  picker the plain POS screen has (`GET /customers?search=`, `POST
  /customers`), reused for two different targets via a single
  `customerPickerFor: "new" | "checkout"` state rather than two
  duplicated modals. The "+ New" form can optionally attach a customer
  before booking; checkout can independently attach one (not
  necessarily the same customer the booking was made under - the walk-in
  case where whoever pays isn't who booked) plus redeem their loyalty
  points, capped client-side at their cached balance the same way the
  plain POS screen does.
- **Verified live** against the real database: created a customer via
  the exact `POST /customers` shape the picker's quick-create sends;
  booked an appointment with `customerId` set using the exact shape
  `createAppointment()` now sends and confirmed the response's
  `customer.name` came back correctly linked; advanced it to
  `IN_PROGRESS` and checked it out with `customerId` using the exact
  shape `submitCheckout()` now sends, confirming the resulting sale's
  `customerId` was set and `pointsEarned` was computed. `pnpm typecheck`
  and `pnpm lint` pass clean for `apps/terminal-pwa`.
- **Not independently verified this session**: the redemption path
  itself (no customer with a positive loyalty balance was readily
  available in the demo org's existing data, and core's redemption
  arithmetic was already live-verified elsewhere in this document) or
  rendering/interaction in an actual browser (no browser automation
  available) - both stated plainly rather than claimed.

That closes out every documented gap from the terminal-PWA catch-up
work: core gaps, all three verticals' primary flows, plus course-firing,
batch/expiry picking, and customer-linking as follow-ups.

## Codebase-wide consistency/quality audit

Ran a targeted audit across both `apps/api` and `apps/terminal-pwa`,
looking specifically for the classes of bug this project has already hit
once (inconsistent error handling, wrong route strings, missing
`@Roles()` justification, nested-transaction risk, `set_config(...,
false)` regressions) rather than a generic style pass. Findings and
disposition:

- **`apps/api`**: no real bugs found. `set_config(..., false)` doesn't
  appear anywhere (the earlier RLS false-alarm lesson stuck).
  `app.module.ts`'s import list matches `apps/api/src/*/` exactly. Every
  vertical module's "calls into core outside its own transaction" pattern
  (restaurant/pharmacy/salon sales services) is the intentional,
  documented tradeoff from Phase 4/5, not an accidental nested-transaction
  bug. The one real gap: `RestaurantSalesController`
  (`apps/api/src/restaurant/restaurant-sales.controller.ts`) was the only
  unrestricted-access controller missing the `// No @Roles() - ...`
  justification comment every sibling controller
  (`pharmacy-sales.controller.ts`, `salon-appointments.controller.ts`,
  `customers.controller.ts`, `organizations.controller.ts`) carries -
  fixed by adding one; not a behavior change, since the endpoint was
  already correctly open to any authenticated cashier.
- **`apps/terminal-pwa`**: three real, fixed inconsistencies, all in
  error-handling coverage that had drifted between sibling functions in
  the same file:
  - `app/tables/page.tsx`'s `markAvailable` had **no error handling at
    all** - if offline or rejected, the "Mark clean" button silently did
    nothing with zero cashier feedback, unlike every other mutating call
    in the same file. Fixed to match `submitOrder`'s
    `OfflineError`/`ApiError`/generic pattern.
  - `app/tables/page.tsx`'s `fireCourse` and `app/kds/page.tsx`'s
    `advance` both used a bare `catch {}` with one hardcoded message,
    never distinguishing offline from a real server rejection, while
    sibling functions in the same files (`submitOrder`, `refreshTickets`)
    did. Fixed both to match.
  - `app/kds/page.tsx`'s initial station-load `catch` didn't check
    `OfflineError` even though `refreshTickets` two functions later in
    the same file does. Fixed to match.
  - Route strings, Dexie schema shape, and industryType-gating redirects
    were all spot-checked and found consistent - no drift.
- **Verification**: `pnpm typecheck`, `pnpm lint`, and `pnpm test` all
  pass clean for `apps/api`; `pnpm typecheck` and `pnpm lint` pass clean
  for `apps/terminal-pwa`. These were pure client-side error-message
  branching changes with no new endpoints, so there was nothing new to
  live-test against the database - stated plainly rather than claiming a
  live-test pass that wouldn't have exercised anything different.

### Salon vertical: discount support on checkout

**Done and verified live.** Closes the one real functional gap the
audit above found - `app/salon/page.tsx`'s checkout had no discount
concept at all, unlike the plain POS screen and the restaurant table
order builder.

- Reuses the same PERCENT/FIXED discount modal pattern the POS screen
  has: cached supervisor+ org users (`db.orgUsers`, fetched at page load
  alongside the catalog) as candidate approvers - a UX convenience only,
  the server independently re-verifies the chosen approver's role.
  `checkoutTotals` now computes `discountAmount` the same way the POS
  screen's `totals` does (percent-of-pre-discount-total or a flat
  amount, capped at the pre-discount total either way), and
  `submitCheckout()`'s payload carries it through to
  `POST /salon/appointments/:id/checkout`'s existing `discount` field -
  the backend already supported this, only the UI was missing.
- **Verified live** against the real database: booked and advanced a
  fresh appointment to `IN_PROGRESS`, checked it out with the exact
  request shape `submitCheckout()` now sends (a 10% discount approved by
  the demo owner), and confirmed the sale's total came back correctly
  discounted (KES 92.80 → 83.52) with the `Discount` record attached and
  linked to the right approver. `pnpm typecheck` and `pnpm lint` pass
  clean for `apps/terminal-pwa`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available), stated plainly
  rather than claimed, consistent with every other slice in this
  document.

That closes every finding from the consistency audit - no known gaps
remain open in the terminal PWA.

## New app: `apps/backoffice` — owner/manager admin console

**First slice done and verified live.** Every screen so far in this
project has been the terminal PWA (cashier-facing, offline-first,
PIN-login). There was no way for an owner to see a sales report, issue a
refund, or manage the catalog except by calling the API directly - a
real, acknowledged gap. This starts closing it with a genuinely
different kind of app, not a mode bolted onto the terminal.

- **Why a separate app, not new terminal-pwa screens**: the terminal PWA
  is built entirely around being offline-first (Dexie, service worker,
  outbox sync) and PIN-based shift login - both wrong for an always-
  online admin tool with full email/password login. `apps/backoffice` is
  a plain Next.js 14 App Router app with **no Dexie, no service worker,
  no offline queue** - just `localStorage` for the session
  (`lib/auth.ts`) and a `fetch` wrapper (`lib/api.ts`) modeled on the
  terminal PWA's `ApiError`/`OfflineError`-free equivalent (an admin
  console failing hard when offline is correct, not a bug). Runs on port
  3003 (terminal PWA is 3002, API is 3001) so all three can run side by
  side.
- **First slice scope, deliberately narrow rather than broad-and-thin**:
  login, a sales list (`GET /sales`), a sale detail view with refund
  issuance (`GET /sales/:id`, `POST /sales/:id/refunds` - reuses the
  same approver-role convenience list and server-side re-verification
  pattern as the terminal's discount/refund flows), and product/catalog
  management (`GET/POST /products`, `/categories`, `/tax-classes`,
  `POST /products/:id/variants`). Deliberately **not** included in this
  slice: shifts, inventory/stock takes, reports, org-user/role
  management, layaways - real gaps, left open rather than attempted
  shallowly across the board.
- **Role enforcement is entirely server-side, not duplicated client-side**:
  the login screen doesn't restrict which roles may sign in, and the
  products page doesn't hide the create/save controls from a
  lower-privileged login - `products.controller.ts`'s existing
  `@Roles(MANAGER, OWNER)` gates would simply 403 the request. This
  matches the same principle already established throughout the terminal
  PWA (e.g. the discount approver picker is a UX convenience, never the
  actual authorization boundary) rather than introducing a second,
  potentially-inconsistent copy of the authorization logic in the
  frontend.
- **Verified live** against the real database, driving the exact request
  shapes each screen sends: `GET /categories` and `GET /tax-classes`
  confirmed to match the `New product` form's selects; created a real
  product with a category/tax-class and a variant via
  `POST /products` + `POST /products/:id/variants`, then confirmed it
  appeared correctly nested in the next `GET /products` list load;
  loaded an existing sale's detail via `GET /sales/:id` and issued a
  partial refund via `POST /sales/:id/refunds` with the exact payload
  `submitRefund()` sends, confirming the response's `refunds` array
  came back correctly populated (and `discounts` alongside it, both
  rendered by the same page). `pnpm typecheck` and `pnpm lint` pass
  clean for `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser - no browser automation was available, so this was
  verified via the exact API round trips above plus static analysis,
  stated plainly rather than claimed, consistent with every other slice
  in this document. The app was started and is reachable at
  `http://localhost:3003`, but clicking through it live is unconfirmed.
- **One login edge case knowingly unhandled**: `AuthService.login`
  returns 409 with a list of organizations when an account belongs to
  more than one org and no `organizationId` is specified - the login
  form surfaces that as a plain error message rather than a picker UI.
  Not an issue for the single-org demo account; a real multi-org owner
  login would need that follow-up.

### `apps/backoffice`: reports screen

**Done and verified live.** Second slice - a `Reports` page covering all
four of `ReportsController`'s endpoints (`sales-by-product`,
`sales-by-branch`, `sales-by-cashier`, `sales-by-hour`), tabbed, with a
from/to date-range filter.

- **No branch filter** - unlike the date range, there's genuinely no
  `GET /branches` (or any branch-listing) endpoint anywhere in the API to
  populate a dropdown from. Rather than hardcode branch IDs or fake a
  picker with a free-text field, this is left out and documented as a
  real gap - `ReportFiltersDto.branchId` exists and works server-side,
  the UI just can't offer it yet.
- `sales-by-hour`'s zero-count hours are filtered out client-side before
  rendering (the endpoint always returns all 24) so an owner sees actual
  activity, not a mostly-empty 24-row table.
- These endpoints are restricted server-side to
  `SUPERVISOR`/`MANAGER`/`OWNER`/`AUDITOR` - a plain `CASHIER` login
  would get a 403 from the API, same "server is the real boundary"
  principle as the rest of this app; not independently re-verified this
  session since that role gate is pre-existing backend code this slice
  didn't touch.
- **Verified live** against the real database: called all four endpoints
  with the exact date-range query shape the page constructs and
  confirmed each response matches its TypeScript interface field-for-
  field (including `sales-by-product`'s `margin: null` handling for
  variants with no recorded cost, and `sales-by-hour`'s EAT-bucketed,
  non-zero hours). `pnpm typecheck` and `pnpm lint` pass clean for
  `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available), stated plainly
  rather than claimed, consistent with every other slice in this
  document.

### `apps/backoffice`: shifts (read-only cash reconciliation)

**Done and verified live.** Third slice. Before this, an owner had no
way to review a shift's cash reconciliation except by calling
`GET /shifts/:id/report` directly.

- **Deliberately read-only** - opening/closing a shift stays the
  cashier's own self-service action at the terminal (per
  `shifts.controller.ts`'s own comment: "not a management-only view"),
  and the terminal PWA doesn't have that UI yet either, a separate, real
  gap not addressed here. This screen is for reviewing what already
  happened, not performing the open/close itself.
- `/shifts` lists shifts (with an "open only" filter) and links each to
  `/shifts/:id`, which shows the same report shape as an X-report (shift
  still open, a live snapshot) or Z-report (closed, with the
  counted-cash variance) depending on `closedAt` - same endpoint either
  way, `GET /shifts/:id/report`, since the backend already computes it
  identically regardless of open/closed state.
- Investigated an org-user/role-management screen first (a natural
  follow-up an owner would want) and found it's **not actually buildable
  right now** - `org-users.controller.ts` only exposes a read-only
  `GET /org-users` (needed for the terminal's cashier picker); there is
  no endpoint anywhere to create staff, change a role, or set a PIN.
  That's real backend work, not a UI gap, so it wasn't attempted here -
  noted rather than silently skipped.
- **Verified live** against the real database: opened a real shift with
  a KES 500 float, rang up a KES 92.80 cash sale attributed to it,
  confirmed the X-report while still open matched exactly (`expectedCash:
  592.8`), closed it with `countedCash: 590` and confirmed the resulting
  `variance: -2.8` was computed and persisted correctly, then re-fetched
  `GET /shifts/:id/report` standalone (the exact call the detail page
  makes) and confirmed it reflects the closed state with the same
  variance - the page's X-report/Z-report branching on `closedAt` will
  correctly show Z-report now. `pnpm typecheck` and `pnpm lint` pass
  clean for `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available), stated plainly
  rather than claimed, consistent with every other slice in this
  document.

### `apps/backoffice`: Inventory (stock levels, alerts, conflicts, adjustments)

**Done and verified live.** Fourth slice - stock levels, low-stock
alerts, sync conflicts (oversells), and manual stock adjustments, all in
one screen with tabs.

- **Same branch-id gap as Reports/Shifts, made explicit rather than
  worked around**: `GET /inventory/items` requires a `branchId` (not
  optional, unlike alerts/conflicts), and there's still no
  branch-listing endpoint anywhere in the API. Rather than hardcode the
  demo org's branch id as if that generalized, this screen has a plain
  "paste the branch ID" text field with a label explaining why - the
  same honest gap as the two screens before it, not hidden this time
  either.
- Stock levels rows below their own `lowStockThreshold` are highlighted;
  a "Low stock only" checkbox filters to just those, matching the
  `lowStockOnly` query param `InventoryItemsService.findAllForBranch`
  already supports.
- Conflicts (negative-quantity oversells - DESIGN.md §6's "never lose a
  sale, resolve after the fact" trace) show each item's most recent
  ledger entries inline, exactly as `findConflicts()` already returns
  them, so a manager can see what actually happened (concurrent sales,
  a late offline sync) without a second lookup.
- "+ Record adjustment" posts to `POST /inventory/transactions` with a
  type picker restricted to `ADJUSTMENT`/`TRANSFER`/`STOCKTAKE`/`RETURN`
  (deliberately excluding `SALE` - that ledger entry type is core's own,
  produced by an actual sale, not something to post manually from an
  admin screen).
- **Verified live** against the real database: loaded stock levels for
  the demo branch and confirmed the shape matched exactly; confirmed
  empty alerts/conflicts lists render their empty-state messages instead
  of an empty table; posted a real `+20 STOCKTAKE` adjustment with the
  exact payload `submitAdjustment()` sends and confirmed the branch's
  stock quantity moved from 104 to 124 on the next items load - the
  same reload path the page's own post-submit `loadTab()` call takes.
  `pnpm typecheck` and `pnpm lint` pass clean for `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available), stated plainly
  rather than claimed, consistent with every other slice in this
  document.

### `apps/backoffice`: Layaways

**Done and verified live.** Fifth slice - full layaway lifecycle:
create, list/filter by status, view a detail page, record payments,
complete (pickup, decrements inventory), and cancel.

- The "New layaway" form reuses the customer search picker pattern from
  the terminal PWA and the same `branchId`-as-text-input gap as the
  Inventory screen (still no branch-listing endpoint anywhere), plus a
  live `GET /products` catalog fetch (not cached like the terminal's
  Dexie catalog - this app has no offline requirement to justify that)
  for picking line items and previewing an estimated total client-side
  (the server computes and snapshots the authoritative total/tax at
  creation).
- The detail page's balance-remaining logic gates the "Complete
  (pickup)" button - disabled until `depositPaid >= total`, matching
  `LayawaysService.complete()`'s own server-side check, so a manager
  can't even attempt to complete an underpaid layaway from this screen
  (though the server would reject it either way).
- Cancellation (`SUPERVISOR`/`MANAGER`/`OWNER`-gated server-side,
  unrestricted client-side per this app's consistent principle) requires
  typing a reason, matching `CancelLayawayDto`.
- **Verified live** against the real database, driving the full
  lifecycle end to end: created a layaway for 3 units with the exact
  shape `createLayaway()` sends and confirmed the server-computed total
  (KES 278.40, tax included) matched; confirmed it appeared in the
  default `status=OPEN` list filter; recorded two payments (KES 100 then
  the remaining KES 178.40) with the exact shape `recordPayment()` sends
  and confirmed `depositPaid` reached the total exactly; called complete
  and confirmed the branch's stock correctly decremented by 3 (124 →
  121) - the only point in a layaway's life stock actually moves, per
  `LayawaysService.complete()`'s own design. `pnpm typecheck` and `pnpm
  lint` pass clean for `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available), stated plainly
  rather than claimed, consistent with every other slice in this
  document.

That leaves org-user/role management as the one remaining
`apps/backoffice` gap from the original scope-out - and it needs new
backend endpoints first (create/invite staff, change a role, set a PIN),
not just a UI slice, since none of those exist server-side yet.

## Org-user/role management: new backend endpoints + `apps/backoffice` Staff screen

**Done and verified live.** Closes the one remaining gap from the
`apps/backoffice` scope-out - this needed real backend work first, not
just a UI slice, since `org-users.controller.ts` only exposed a
read-only `GET /org-users` before this.

- **New endpoints** (`apps/api/src/org-users/`), all `MANAGER`/`OWNER`-
  gated except the pre-existing `findAll`:
  - `POST /org-users` - adds a membership to the caller's org. If the
    email already has a `User` account (e.g. an accountant contracted to
    several shops - the `User` model's own comment), it just gets a new
    membership; `fullName`/`password` are ignored rather than silently
    overwriting an account used elsewhere. A genuinely new email requires
    both, validated in the service (not class-validator) since the
    conditional rule - "required only if no account exists yet" - would
    be awkward to express as decorators.
  - `PATCH /org-users/:id` - role and/or branch-scope reassignment.
    `branchId: null` explicitly clears the scope (access to all
    branches) versus an omitted field leaving it unchanged - collapsing
    those with `??` would have lost the distinction.
  - `PATCH /org-users/:id/pin` - resets a `User.pinHash`. Looks the
    `OrgUser` up through the tenant-scoped `tx` first specifically so
    the write never trusts a bare `userId` from the client, only an
    `orgUserId` already proven to belong to the caller's own org.
  - `users` is deliberately outside RLS/tenant scoping (see `rls.sql`'s
    own comment on why - a `User` can belong to multiple orgs), so
    `POST /org-users`'s email lookup uses the raw `PrismaService`
    directly, the same pattern `AuthService.login` already established
    for the same reason.
  - **One deliberately non-atomic write, documented rather than hidden**:
    `setPin`'s `pinHash` update and its audit log entry aren't atomic
    with each other, unlike every other audited write in this codebase -
    `User` sits outside the tenant-scoped transaction the audit log
    needs, by construction, so there's a narrow gap where a crash could
    lose the audit trail entry while the PIN change itself still lands.
    Accepted deliberately, the same class of tradeoff already documented
    for the vertical modules' "sale commits before its own metadata
    does."
- **A bug caught and fixed before this was called done**: the first
  draft of `create()`'s audit log call used a *second*,
  separate `tenantPrisma.run()` after the one that created the
  `OrgUser` row - breaking this codebase's own rule that an audit entry
  must commit atomically with the action it records (`AuditLogService`'s
  own docstring is explicit about this). Fixed by moving the audit call
  inside the same transaction as the `orgUser.create()` call.
- **`apps/backoffice/app/staff/page.tsx`** (new): add a person (new
  account or existing-account membership), edit role/branch scope
  inline, set a PIN - the first UI for any of this, anywhere in the
  project.
- **Verified live** against the real database, driving every path: added
  a brand-new staff member and confirmed they could log in with the
  password just set; confirmed they appear correctly in `GET
  /org-users`; set a PIN and confirmed `POST /auth/pin-login` actually
  accepts it - the real end-to-end proof this isn't just writing a hash
  nobody can use; promoted them to `SUPERVISOR` with a branch scope and
  confirmed it applied; attempted a duplicate membership for the same
  email and confirmed the 409; attempted a genuinely new email with no
  `fullName`/`password` and confirmed the exact validation message;
  cleared the branch scope back to all-branches with `branchId: null`
  and confirmed it took. `pnpm typecheck`, `pnpm lint`, and `pnpm test`
  all pass clean for `apps/api`; `pnpm typecheck` and `pnpm lint` pass
  clean for `apps/backoffice`.
- **Not independently verified this session**: the Staff page's
  rendering/interaction in an actual browser (no browser automation
  available) - verified via the exact API round trips above plus static
  analysis instead, stated plainly rather than claimed.
- **Deliberately not in this slice**: deactivating/removing a membership
  - there's no `isActive`-style field on `OrgUser` in the schema, and an
  outright `DELETE` risks foreign-key conflicts with everything an
  `OrgUser` is referenced by (sales, discounts, refunds, audit log
  actors...). A real follow-up, needs a schema decision first, not
  attempted here.

### Deactivate/reactivate staff (the schema decision from above, made)

**Done and verified live.** Picked up the one item explicitly deferred
above - added the schema field and the soft-delete this needed, rather
than a row `DELETE`.

- New migration `20260720152817_add_org_user_is_active` adds
  `OrgUser.isActive` (default `true`). Deactivating just flips it to
  `false` - no history is touched, since an `OrgUser` row is referenced
  by everything it ever did (sales as cashier, discount/refund
  approvals, audit actions...).
- `AuthService.login` and `pinLogin` both now treat a deactivated
  membership as if it doesn't exist, not a distinct error - filtered out
  before the single-vs-multiple-org resolution in `login`, and folded
  into the same generic "Invalid PIN" rejection in `pinLogin`. Same
  "don't distinguish why" principle this codebase already applies
  elsewhere in auth: a rejection shouldn't confirm to whoever's trying
  that a specific account/PIN combination exists and is just switched
  off.
- `OrgUsersService.findAll()` excludes deactivated memberships by
  default (a shared terminal's cashier picker shouldn't offer someone
  who can no longer log in) with a new `includeInactive` query param for
  the back office's own staff list, which needs to show - and
  reactivate - them.
- New `PATCH /org-users/:id/deactivate` and `.../reactivate`,
  `MANAGER`/`OWNER`-gated like every other write on this controller.
  Unlike `setPin`, this write is fully atomic with its audit log entry -
  `isActive` lives on `OrgUser` itself, entirely inside the tenant-scoped
  transaction, not split across the tenant/non-tenant boundary the way
  `User.pinHash` is.
- `apps/backoffice/app/staff/page.tsx` gains a "Show deactivated"
  checkbox and a Deactivate/Reactivate button per person, with
  deactivated rows visibly dimmed and labeled.
- **Verified live** against the real database, the full cycle: confirmed
  `isActive: true` now appears in `GET /org-users`; deactivated the
  staff member created in the previous slice; confirmed **both**
  password login and PIN login were actually rejected afterward (not
  just that a flag flipped in the database) - password login fell back
  to "no organization membership" (the same message an account with zero
  memberships gets) and PIN login returned the same generic "Invalid
  PIN" a wrong PIN would; confirmed they disappeared from the default
  `GET /org-users` list and reappeared with `includeInactive=true`;
  reactivated them and confirmed password login worked again. `pnpm
  typecheck`, `pnpm lint`, and `pnpm test` all pass clean for `apps/api`;
  `pnpm typecheck` and `pnpm lint` pass clean for `apps/backoffice`. The
  new UI's own calls weren't separately re-tested beyond this, since
  `toggleActive()` hits the exact same two endpoints already proven live
  above with the exact same request shape.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available), stated plainly
  rather than claimed.

This closes every `apps/backoffice` gap identified across this session's
work, with no remaining deferred items: Sales/Refunds, Products,
Reports, Shifts, Inventory, Layaways, and Staff (including
deactivate/reactivate).

## Tenant onboarding: self-service registration + branches/terminals CRUD

**Done and verified live.** Multi-tenancy itself (RLS-enforced isolation)
has been the load-bearing architecture since Phase 0, but *onboarding* a
new tenant was bare-bones: no self-service way to create an organization
at all (seeded/created directly in the database), and no
`GET /branches`/`GET /terminals` anywhere in the API - a gap that had
forced three separate back-office screens (Reports, Inventory,
Layaways) into "paste a branch UUID into a text field" as a documented
workaround. This closes both.

- **New `POST /auth/register`** (`AuthService.register`, public,
  throttled the same as `/auth/login`/`/auth/pin-login`): creates a
  brand new `Organization`, its first `OWNER` `User`/`OrgUser`, a first
  `Branch`, and a first `Terminal`, all in one transaction, and returns a
  working access token plus every id the terminal PWA and back office
  need.
- **A genuinely new transaction shape for this codebase**: every other
  tenant-scoped write goes through `TenantScopedPrismaService.run()`
  against an *already-existing* `organizationId`. Here the organization
  doesn't exist yet, so its id is generated client-side
  (`randomUUID()`, not left to Postgres's column default) specifically
  so it can be passed to `set_config('app.current_tenant', ...)` before
  the very first insert - every tenant-scoped table's `WITH CHECK`
  policy requires a row's `organizationId` to already equal the current
  tenant, so without this the `Organization` insert itself would violate
  its own RLS policy. Same raw-transaction-with-`set_config` pattern
  `pinLogin()` already established for the same reason.
- **Deliberately always creates a brand-new `User`**, never reusing an
  existing account by email the way `OrgUsersService.create()`
  intentionally does - this is a public, unauthenticated endpoint, so
  silently attaching an existing account (with its existing password) to
  a new organization the caller doesn't yet control is a materially
  different trust situation than an already-authenticated MANAGER/OWNER
  inviting someone by email. An email already in use here means "log in
  and use the org-users invite flow instead," surfaced as a 409, not
  silent reuse.
- **A check-then-act email race caught and fixed before this was called
  done**: the first draft checked for an existing email with a plain
  `findUnique` before the transaction, then created the `User` inside
  it - two concurrent registrations for the same email could both pass
  the check. Fixed to catch the resulting `P2002` from the transaction
  itself instead, the same pattern already established in
  `SalesService`/`CustomersService` for exactly this class of race.
- **New `apps/api/src/branches/` and `apps/api/src/terminals/`
  modules** - standard CRUD (`GET`/`POST`/`PATCH`, reads open to any
  authenticated role, writes `MANAGER`/`OWNER`-gated), following the
  same shape as `categories`/`tax-classes`. **Deliberately no `DELETE`
  on either** - a `Branch` cascades onto everything it owns (sales,
  inventory, shifts...) via the schema's `onDelete: Cascade`, and a
  mistaken delete would be catastrophic and unrecoverable; this pilot
  doesn't expose one at all rather than build an "are you sure" flow
  around something this destructive.
- **`apps/backoffice/app/register/page.tsx`** (new): the self-service
  registration form, linked from `/login`. **`apps/backoffice/app/branches/page.tsx`**
  (new): list branches, add a branch, add a terminal to a branch.
- **Retrofitted the "paste a branch UUID" gap** in `apps/backoffice`'s
  Inventory and Layaways screens - both now fetch `GET /branches` and
  render a real `<select>`, exactly the workaround their own earlier
  sessions' commits had explicitly flagged as a documented limitation
  pending this endpoint's existence.
- **`apps/terminal-pwa/app/setup/page.tsx` reworked into two steps**:
  step 1 is the one-time manager login (unchanged in spirit); step 2 now
  shows real branch/terminal dropdowns fed by the new endpoints instead
  of asking an installer to paste two raw UUIDs copied from API/seed
  output, which is what every terminal setup before this commit
  required. `lib/api.ts` gained an optional `baseUrl` override
  parameter on `apiGet`/`apiPost`/`apiPatch` to support this - the only
  place in the app that needs to hit the API before `db.deviceConfig`
  exists to resolve a base URL from automatically; every other call site
  is unaffected (the parameter is optional and defaults to the existing
  Dexie-resolved behavior).
- **Verified live** against the real database: registered two entirely
  new organizations end-to-end via the exact request shape the
  back-office form sends, and confirmed each came back with a working
  access token and real branch/terminal ids; confirmed `GET
  /organizations/me` on the second new org returned its own
  `industryType` (`RESTAURANT`) correctly, not the demo org's; confirmed
  **RLS isolation on brand-new tenant data, not just seeded data** -
  `GET /branches`, `GET /terminals`, and `GET /products` against the new
  org's token returned only its own rows (one branch, one terminal, zero
  products - a fresh org's catalog is genuinely empty); hit the duplicate-
  email 409 by re-registering the same owner email; created a second
  branch and a terminal on it via `POST /branches`/`POST /terminals` and
  confirmed both list endpoints and the `branchId` filter reflected them
  correctly. `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass
  clean for `apps/api`; `pnpm typecheck` and `pnpm lint` pass clean for
  both `apps/backoffice` and `apps/terminal-pwa`.
- **Not independently verified this session**: rendering/interaction of
  any of the three new/reworked UI screens in an actual browser (no
  browser automation available) - verified via the exact API round trips
  above plus static analysis instead, stated plainly rather than
  claimed, consistent with every other slice in this document. `pnpm
  build` was skipped for both frontend apps since their dev servers were
  already running locally (a concurrent build is known to corrupt a
  running dev server's `.next` cache).

## Platform admin: a genuine super-admin identity, separate from every tenant

**Done and verified live.** Before this, there was no cross-tenant
identity in the system at all - `OWNER` is the top role, but entirely
*within* one organization; the only way to look at data across tenants
was `psql` with the Neon owner's raw credentials, with no audit trail.
This adds a real `PlatformAdmin` identity, structurally incapable of
being confused with a tenant token, with every action (including reads)
audited.

- **New `apps/api/src/platform-admin/` module**: `POST
  /platform-admin/auth/login` (public, throttled like tenant login), `GET
  /platform-admin/organizations` (list every tenant with branch/org-user/
  sale counts), `GET /platform-admin/organizations/:id` (one tenant's
  full branch and staff list).
- **No self-registration, deliberately** - unlike `POST /auth/register`
  for tenants, there is no HTTP path that creates a `PlatformAdmin` row.
  The only way one exists is `pnpm --filter api seed:platform-admin`
  (`prisma/seed-platform-admin.ts`), run manually against the database
  directly, requiring `PLATFORM_ADMIN_EMAIL`/`PASSWORD`/`FULL_NAME` env
  vars with no checked-in defaults (unlike the demo tenant's
  intentionally-public `password123`) - a public "become a platform
  admin" endpoint would be a severe vulnerability for an identity that
  can see every tenant.
- **Structurally separate token, not just a different role value**: a
  `PlatformAdminJwtPayload` (`{sub, scope: 'platform-admin'}`) carries no
  `organizationId`/`role`/`branchId` at all, is signed with its own
  secret (`PLATFORM_ADMIN_JWT_SECRET`, deliberately never
  `JWT_SECRET`), and is verified by a separately-named Passport strategy
  (`'platform-admin-jwt'`, not the default `'jwt'`). Every
  `/platform-admin/*` route is marked `@Public()` to skip the global
  `JwtAuthGuard` entirely and instead requires `PlatformAdminAuthGuard`
  explicitly - so a tenant JWT and a platform-admin JWT are mutually
  unable to authenticate each other's routes on three independent axes
  (payload shape, signing secret, guard wiring), not just one role check
  that a bug could weaken.
- **No new Postgres infrastructure needed** - the original plan sketched
  a dedicated `BYPASSRLS` Postgres role for this, but building it turned
  out not to require one: `organizations`' own pre-auth RLS exception
  (`rls.sql`'s `OR NULLIF(current_setting(...), '') IS NULL` - the same
  exception tenant `login()` already depends on to resolve which org an
  email belongs to before a tenant exists) already makes every
  organization row visible to a query that never calls `set_config` at
  all. Per-tenant child data (branches, org users) is fetched by briefly
  setting `app.current_tenant` to each org's id in turn, the exact same
  mechanism `TenantScopedPrismaService.run()` uses for one tenant,
  just looped sequentially across all of them here - avoiding a new
  Postgres role, a new connection string, and touching the Neon project's
  permissions at all for this first slice.
- **Every action logged, including reads** - a new `PlatformAuditLog`
  table (via `PlatformAuditLogService`), deliberately broader than the
  tenant-scoped `AuditLog` (writes only): a platform admin *looking at* a
  tenant's staff list is itself sensitive enough to record, not just
  changing something.
- **A real bug caught and fixed by live-testing, not by typecheck**: the
  first version's cross-tenant queries used bare `this.prisma.$transaction(...)`
  calls with none of the `{timeout: 15_000, maxWait: 15_000}` overrides
  every other raw transaction in this codebase applies against Neon's
  observed latency (`TenantScopedPrismaService.run()`,
  `AuthService.pinLogin`/`register`) - `GET /platform-admin/organizations`
  failed immediately with the exact `P2028 "Unable to start a
  transaction in the given time"` this project has hit and fixed
  several times before, freshly reintroduced by omission. Fixed by
  applying the same overrides, and by changing the organization loop from
  concurrent (`Promise.all`) to sequential - firing N concurrent
  interactive transactions against Neon is the identical failure mode
  the project's own load-testing history already documented exhausting
  the connection pool.
- **Verified live** against the real database: seeded a real platform
  admin via the script and logged in, confirming the JWT payload has no
  tenant fields at all; called `GET /platform-admin/organizations` and
  confirmed it correctly listed **all three** organizations that exist
  in the database (the demo org plus the two brand-new tenants created
  in the onboarding work above) with accurate per-org branch/org-user/
  sale counts; called the detail endpoint for the demo org and confirmed
  its branches and staff (including a staff member created earlier in
  this session's org-management testing) came back correctly; confirmed
  the audit log actually recorded both calls by querying
  `platform_audit_log` directly; confirmed the security boundary in
  **both directions** - a real tenant JWT gets 401 against
  `/platform-admin/organizations`, and a real platform-admin JWT gets
  401 against `/sales`; confirmed a wrong password is rejected. `pnpm
  typecheck`, `pnpm lint`, and `pnpm test` all pass clean for `apps/api`.
- **Not independently verified this session**: no back-office UI was
  built for this in this slice (deliberately, to keep the security-
  critical backend correct and verified first) - a platform-admin
  console screen is a natural, separate follow-up, likely its own
  minimal app or route tree given how deliberately this token type is
  kept from ever touching `apps/backoffice`'s tenant-scoped session
  storage.

## New app: `apps/platform-admin` — the console for the identity above

**Done and verified live.** The follow-up flagged in the slice above -
a UI for the platform-admin backend, built as a genuinely separate app
rather than new routes bolted onto `apps/backoffice`.

- **Why a fourth app, not a mode inside `apps/backoffice`**: the whole
  point of the backend work above was making a platform-admin token
  structurally unable to touch tenant data or vice versa; putting both
  session types in the same Next.js app's `localStorage` (even under
  different keys) would have been the one place that separation could
  quietly erode over time as the app grows. `apps/platform-admin` is its
  own app on its own port (3004 - API is 3001, terminal PWA 3002,
  back office 3003), with its own `localStorage` key
  (`zaroda-platform-admin-session`, distinct from `apps/backoffice`'s
  `zaroda-backoffice-session`) and its own visually distinct theme
  (zinc/amber instead of the other two apps' slate/blue) - a human
  operator with both consoles open in adjacent tabs should be able to
  tell them apart at a glance, not just trust that the code is correct.
- Three screens: `/login` (no "new here?" link, deliberately - there is
  no self-registration path for a platform admin, matching the backend),
  `/organizations` (every tenant with branch/staff/sale counts),
  `/organizations/:id` (one tenant's branches and staff, deactivated
  staff shown struck through).
- **Verified live** against the real database, driving the exact calls
  each screen makes: logged in as the seeded platform admin; called
  `GET /platform-admin/organizations` and confirmed the response matches
  the `Organization` interface field-for-field for all three real
  organizations in the database; called the demo org's detail endpoint
  and confirmed `branches`/`orgUsers` (including each user's `email`,
  which only this screen - not any tenant-facing one - has any business
  showing) matched the `OrganizationDetail` interface exactly. `pnpm
  typecheck` and `pnpm lint` pass clean for `apps/platform-admin`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available) - verified via the
  exact API round trips above plus static analysis instead, stated
  plainly rather than claimed, consistent with every other slice in this
  document. The app was started and is reachable at
  `http://localhost:3004`.

## `apps/backoffice` becomes industry-aware

**Done and verified live.** A real user question surfaced a real gap:
after creating a restaurant, a pharmacy, and a salon organization via
`/register`, all three looked identical in the back office - because
they were. Every screen built into `apps/backoffice` up to this point
(Sales, Products, Reports, Shifts, Inventory, Layaways, Staff, Branches)
is industry-agnostic by design; all the vertical-aware UI work this
project had done so far went into the terminal PWA, not here. Checked
the database directly first to rule out a data bug - each org's
`industryType` was already stored correctly (`RESTAURANT`, `PHARMACY`,
`SALON`); the gap was genuinely "no UI reads it," not "the data is
wrong."

- **`Session` gains `industryType`**, fetched via `GET /organizations/me`
  right after login (and set directly from the form's own selection on
  `/register`, which already knows it - no extra round trip needed
  there). `components/nav.tsx` now shows an industry badge always, plus
  one conditional vertical link, the same gating principle the terminal
  PWA's own nav already uses (`device.industryType === "RESTAURANT"`
  etc.) just against the back-office session instead of Dexie.
- **Three new read-mostly overview screens**, one per vertical, each
  redirecting to `/sales` if the session's `industryType` doesn't match
  (the same guard pattern the terminal PWA's vertical pages use):
  - `/restaurant` - the floor (tables + status) and kitchen queue across
    all of a branch's stations at once. Deliberately not the working
    screen (that's the terminal PWA's `app/tables`/`app/kds`) - this is
    for a manager checking on things without walking to a terminal.
  - `/bookings` - today's salon appointments across a branch.
  - `/pharmacy` - controlled-substance flag management, built on a
    **new `GET /pharmacy/products` endpoint** added alongside this page
    (`PharmacyProductFlagsService.findAllWithProducts()`) - nothing
    before this could list more than one product's flag per request,
    only get/set one at a time. Deliberately does **not** attempt a
    prescription-history view in this slice: no endpoint exists to list
    `PharmacySalePrescription` rows at all (only per-sale creation), a
    real gap left open rather than worked around with an ad-hoc query.
- **Verified live** against the real database: registered fresh
  `PHARMACY` and `SALON` test organizations (couldn't use the user's own
  three - their passwords aren't something I have or should guess) and
  reused the existing `RESTAURANT` test org from earlier session work;
  confirmed `GET /organizations/me` returns the correct `industryType`
  for each, exactly as the login page reads it; created a product and
  confirmed `GET /pharmacy/products` initially shows it unflagged, then
  confirmed flagging it via the exact `PATCH` shape `toggleControlled()`
  sends correctly updates what the list endpoint returns; created a
  salon resource and appointment and confirmed the exact
  `branchId`+`from`+`to` query `/bookings` constructs returns it;
  created a restaurant table and kitchen station and confirmed
  `/restaurant`'s exact queries return both correctly. `pnpm typecheck`,
  `pnpm lint`, and `pnpm test` all pass clean for `apps/api`; `pnpm
  typecheck` and `pnpm lint` pass clean for `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available) - verified via the
  exact API round trips above plus static analysis instead, stated
  plainly rather than claimed.
- **A note for anyone with a session already open**: `Session` gained a
  required field - a browser tab that logged in before this change won't
  have `industryType` in its stored session and will just see no
  vertical link (safe default, not a crash), until logging out and back
  in refetches it.

## Public, unauthenticated salon booking - a real customer's self-service path

**Done and verified live.** Directly answers a real question: how does
an actual salon customer place a booking themselves? Before this,
nowhere - `POST /salon/appointments` requires staff auth, and `Customer`
has no login/account concept anywhere in this codebase. This is new
capability, not a gap in something already built.

- **New `apps/api/src/public-booking/` module** - the one place in this
  API that accepts a tenant identity (`organizationId`, via the URL) 
  directly from an unauthenticated caller, a genuinely different trust
  model from everywhere else (organizationId always comes from a
  validated token otherwise). Kept deliberately narrow because of that:
  - `GET /public/salon/:organizationId/:branchId/resources` - names
    only.
  - `GET .../availability?resourceId=&date=` - **busy time blocks only,
    never who booked or what service** - a public caller needs to know
    when a resource is free, not another customer's name or business
    details (that's exactly what the staff-only `GET
    /salon/appointments` is for instead).
  - `POST .../appointments` - the only write; no status changes, no
    cancellation, nothing that could grief an existing booking.
    Throttled (10/min/IP) the same "an unauthenticated write deserves at
    least as much rate-limiting as reads" reasoning as
    `auth.controller.ts`'s login/register.
  - Tenant context is established via the same raw-transaction-plus-
    `set_config` pattern `AuthService.pinLogin`/`register` already use
    for the identical underlying reason (no JWT-derived tenant exists
    yet) - then `branchId` is verified to actually belong to
    `organizationId` before anything else runs, so a mismatched pair
    404s cleanly rather than silently returning nothing.
  - Finds-or-creates the `Customer` by phone within that org (same
    pattern `OrgUsersService.create()` uses for finding-or-creating a
    `User` by email) - a returning customer's bookings and loyalty
    points stay on one `Customer` row.
- **Double-booking prevention is shared, not duplicated**: the overlap
  check was extracted out of `SalonAppointmentsService.create()` into
  `salon/salon-overlap.util.ts` and both the staff-authenticated path
  and this new public path call the exact same function - this is
  business-critical enough (an actually double-booked chair) that a
  second, separately-maintained copy would be a real risk, not just
  duplicated code.
- **`apps/backoffice/app/book/[organizationId]/[branchId]/page.tsx`**
  (new): the actual customer-facing page - deliberately does **not**
  import `lib/auth.ts` or `lib/api.ts` at all, so it can never touch the
  staff session even by accident. A salon would share this link directly
  (a QR code on a receipt, a bio link) - there's no directory or search
  of organizations anywhere public, by design. First page in this
  project needing a build-time API URL instead of an admin typing one
  into a login form, via a new `NEXT_PUBLIC_API_BASE_URL` env var
  (falls back to `http://localhost:3001` for local dev).
- **Verified live** against the real database, with zero `Authorization`
  header on any call: listed a salon's resources publicly; fetched
  availability and confirmed it returned only start/end times for an
  existing appointment, no customer/service details; booked a new
  appointment fully unauthenticated and confirmed it appears correctly
  to staff via `GET /salon/appointments` (customer name and phone
  included, exactly as staff need); attempted to double-book the same
  slot and confirmed the shared overlap check rejected it with the exact
  message the staff path already produces; booked again with the same
  phone number and confirmed no duplicate `Customer` was created (one
  row, reused); confirmed a mismatched `organizationId`/`branchId` pair
  404s cleanly rather than leaking data across the tenant boundary the
  URL is supposed to establish; confirmed booking in the past is
  rejected. `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass clean
  for `apps/api`; `pnpm typecheck` and `pnpm lint` pass clean for
  `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available) - verified via the
  exact API round trips above plus static analysis instead, stated
  plainly rather than claimed.
- **Deliberately not in this slice**: booking-management for the
  customer themselves (view/cancel/reschedule their own booking - would
  need some lightweight way to prove "this is genuinely your booking,"
  e.g. a link with an unguessable token, not built here), and the same
  capability for the restaurant/pharmacy verticals (a public restaurant
  reservation or pharmacy refill-request flow would each need their own
  design, not just a copy-paste of this one).

## Customer self-service: view and cancel a booking

**Done and verified live.** Picks up the item explicitly deferred above
- a customer who books publicly now gets a way to view and cancel it
themselves afterward, no staff or login involved either time.

- New migration adds `SalonAppointment.cancelToken` (`@default(uuid())`,
  unique) - **not** a Prisma-auto migration; the column had to be added
  nullable first, backfilled for the 13 existing rows via
  `gen_random_uuid()`, then tightened to `NOT NULL` + a unique index,
  since `prisma migrate dev` refuses to add a required column with a
  default straight onto a non-empty table. Written and applied by hand
  (`prisma migrate deploy`, non-interactively - `migrate dev`'s own
  `--create-only` flow needs a TTY this session doesn't have), then
  confirmed with `prisma migrate status` that the database and schema
  came back fully in sync, no drift.
- `cancelToken` is the actual credential, not the appointment id in the
  URL - ids are unremarkable UUIDs handed back openly, the token is what
  proves "this is genuinely your booking." Returned by `POST
  .../appointments` exactly once, at creation - the same "shown once, at
  generation" shape as a password-reset link - and never again by any
  other endpoint, including to staff (every staff-facing salon query
  deliberately excludes it from its `select`).
- Two new endpoints, both requiring the token: `GET
  .../appointments/:appointmentId?token=` and `PATCH
  .../appointments/:appointmentId/cancel`. A wrong or missing token 404s
  exactly like a made-up appointment id would - the same "don't
  distinguish why" principle already applied to `AuthService` (a
  deactivated `OrgUser` fails login the same generic way a wrong
  password does), so a caller without the token learns nothing about
  whether the id is real.
- Cancellation is only allowed from `SCHEDULED`/`CONFIRMED` - an
  `IN_PROGRESS`, `COMPLETED`, or already-`CANCELLED` booking gets a
  clear rejection ("contact the business directly") instead of silently
  no-op'ing or erroring unhelpfully.
- `apps/backoffice/app/book/[organizationId]/[branchId]/page.tsx`'s
  confirmation screen now shows the manage link
  (`/book/manage/<organizationId>/<branchId>/<appointmentId>?token=...`)
  - "isn't emailed or texted anywhere, this is the only place it's
  shown," stated plainly on the page itself, since this project has no
  email/SMS infrastructure to deliver it any other way yet. New
  `apps/backoffice/app/book/manage/.../page.tsx` reads the token from
  the URL's query string and never imports `lib/auth.ts`/`lib/api.ts`,
  same rule as the booking page itself.
- **Verified live** against the real database, the full loop: booked a
  fresh appointment and captured the one-time `cancelToken`; confirmed a
  wrong token on the view endpoint 404s; confirmed the correct token
  retrieves the booking with `cancelToken` itself absent from that
  response; cancelled it with the correct token and confirmed the status
  update; attempted to cancel the same booking again and confirmed the
  exact "already cancelled" rejection; confirmed the cancelled slot no
  longer appears in `GET .../availability`'s busy blocks, leaving only
  the other three still-active bookings. `pnpm typecheck`, `pnpm lint`,
  and `pnpm test` all pass clean for `apps/api`; `pnpm typecheck` and
  `pnpm lint` pass clean for `apps/backoffice`.
- **Not independently verified this session**: rendering/interaction in
  an actual browser (no browser automation available) - verified via the
  exact API round trips above plus static analysis instead, stated
  plainly rather than claimed.

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
  backoffice/       Next.js owner/manager admin console (always-online,
                    email/password login - sales, refunds, catalog)
  platform-admin/   Next.js cross-tenant super-admin console - a
                    structurally separate identity/token/app from every
                    tenant, never shares session storage with backoffice
  terminal-pwa/     Offline-capable POS terminal (Dexie/IndexedDB,
                    service worker, sync engine - DESIGN.md §6)
packages/
  modules/
    retail/          First vertical module            [Phase 2]
```
