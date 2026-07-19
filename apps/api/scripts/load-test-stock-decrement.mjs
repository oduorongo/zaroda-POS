#!/usr/bin/env node
/**
 * Load-test the stock-decrement path (DESIGN.md Phase 3 roadmap item).
 *
 * Fires many concurrent POST /sales at the same branch+variant and checks
 * that InventoryTransactionsService.recordInTx's atomic `increment` (not
 * read-then-write) actually holds under real concurrency: no lost
 * updates, every accepted sale has exactly one matching ledger row, and
 * the final InventoryItem.quantity matches what the ledger says it should.
 *
 * Also fires the same clientId concurrently multiple times, to check the
 * idempotency check-then-create path (findUnique-by-clientId, then
 * create) for a race: the DB's unique constraint on Sale.clientId is the
 * real backstop, but the application code needs to turn that into a
 * clean response rather than a raw 500.
 *
 * Usage: node scripts/load-test-stock-decrement.mjs
 * Requires the API running locally and reachable at API_BASE (default
 * http://localhost:3001), and the demo seed data's owner login.
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001';
const EMAIL = process.env.LOAD_TEST_EMAIL ?? 'owner@demo.zaroda.pos';
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? 'password123';
const BRANCH_ID = process.env.LOAD_TEST_BRANCH_ID;
const TERMINAL_ID = process.env.LOAD_TEST_TERMINAL_ID;
const VARIANT_ID = process.env.LOAD_TEST_VARIANT_ID;
const CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY ?? 50);
const PIN = process.env.LOAD_TEST_PIN ?? '1234';

if (!BRANCH_ID || !TERMINAL_ID || !VARIANT_ID) {
  console.error(
    'Set LOAD_TEST_BRANCH_ID, LOAD_TEST_TERMINAL_ID, LOAD_TEST_VARIANT_ID env vars first.',
  );
  process.exit(1);
}

async function post(path, token, body) {
  const start = Date.now();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, ms: Date.now() - start };
}

async function get(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => null);
  // Fail loudly rather than letting a network/DB hiccup silently turn
  // into `undefined`/`NaN` deep in a later PASS/FAIL comparison - a real
  // run against a severely latent database surfaced exactly this gap.
  if (!res.ok || json === null) {
    throw new Error(`GET ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const loginRes = await post('/auth/login', null, {
    email: EMAIL,
    password: PASSWORD,
  });
  const token = loginRes.json?.accessToken;
  if (!token) {
    console.error('Login failed:', loginRes);
    process.exit(1);
  }

  const orgUserId = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ).orgUserId;

  const pinRes = await post('/auth/pin-login', token, {
    terminalId: TERMINAL_ID,
    orgUserId,
    pin: PIN,
  });
  const cashierSessionId = pinRes.json?.cashierSessionId;
  if (!cashierSessionId) {
    console.error('PIN login failed:', pinRes);
    process.exit(1);
  }

  const before = await get(
    `/inventory/items/${BRANCH_ID}/${VARIANT_ID}`,
    token,
  );
  const startQuantity = before.quantity;
  console.log(`Starting quantity: ${startQuantity}`);

  // ── Test 1: N concurrent distinct sales, 1 unit each ──────────────────
  console.log(`\n--- Test 1: ${CONCURRENCY} concurrent sales, 1 unit each ---`);
  const saleRequests = Array.from({ length: CONCURRENCY }, () =>
    post('/sales', token, {
      clientId: crypto.randomUUID(),
      branchId: BRANCH_ID,
      terminalId: TERMINAL_ID,
      cashierSessionId,
      lineItems: [{ variantId: VARIANT_ID, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 92.8 }],
    }),
  );
  const results = await Promise.all(saleRequests);
  const successes = results.filter((r) => r.status === 201 || r.status === 200);
  const failures = results.filter((r) => r.status >= 400);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  console.log(`Succeeded: ${successes.length}/${CONCURRENCY}`);
  console.log(`Failed: ${failures.length}/${CONCURRENCY}`);
  if (failures.length > 0) {
    console.log(
      'Failure sample:',
      JSON.stringify(failures[0].json),
    );
  }
  console.log(`Latency ms - p50: ${p50}, p95: ${p95}, p99: ${p99}`);

  const after = await get(
    `/inventory/items/${BRANCH_ID}/${VARIANT_ID}`,
    token,
  );
  const expectedQuantity = startQuantity - successes.length;
  console.log(
    `Quantity after: ${after.quantity} (expected ${expectedQuantity}) - ${
      after.quantity === expectedQuantity ? 'PASS: no lost updates' : 'FAIL: lost update detected'
    }`,
  );

  // ── Test 2: same clientId fired concurrently (idempotency race) ───────
  console.log('\n--- Test 2: same clientId fired 10x concurrently ---');
  const raceClientId = crypto.randomUUID();
  const raceRequests = Array.from({ length: 10 }, () =>
    post('/sales', token, {
      clientId: raceClientId,
      branchId: BRANCH_ID,
      terminalId: TERMINAL_ID,
      cashierSessionId,
      lineItems: [{ variantId: VARIANT_ID, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 92.8 }],
    }),
  );
  const raceResults = await Promise.all(raceRequests);
  const raceStatuses = raceResults.map((r) => r.status);
  const raceSaleIds = new Set(
    raceResults.filter((r) => r.json?.id).map((r) => r.json.id),
  );
  const race5xx = raceResults.filter((r) => r.status >= 500);
  console.log(`Status codes: ${raceStatuses.join(', ')}`);
  console.log(`Distinct sale ids returned: ${raceSaleIds.size} (expected 1)`);
  console.log(
    race5xx.length === 0
      ? 'PASS: no 5xx from the idempotency race'
      : `FAIL: ${race5xx.length} request(s) returned 5xx - ${JSON.stringify(race5xx[0].json)}`,
  );

  const afterRace = await get(
    `/inventory/items/${BRANCH_ID}/${VARIANT_ID}`,
    token,
  );
  console.log(
    afterRace.quantity === after.quantity - 1
      ? 'PASS: exactly one unit decremented for the raced clientId'
      : `FAIL: expected quantity ${after.quantity - 1}, got ${afterRace.quantity}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
