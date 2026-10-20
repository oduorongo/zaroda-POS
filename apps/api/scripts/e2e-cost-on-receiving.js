// End-to-end test of "enter what you paid when stock arrives and the product's cost follows" against a LOCAL test setup:
// a hotel kitchen receives tomatoes at different market prices, by hand, as a batch, and through a purchase order, and the
// cost becomes the weighted average each time. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations, and the API started with the test settings, plus
// the demo seed.
//   node scripts/e2e-cost-on-receiving.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR, process.env.PG_DIR || API_DIR] }));
const readEnv = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};
const env = readEnv(path.join(API_DIR, '.env.local'));
const live = readEnv(path.join(API_DIR, '.env'));
const hostOf = (url) => new URL(url).hostname.replace(/-pooler/, '');
for (const key of ['DATABASE_URL', 'DIRECT_URL']) if (live[key] && hostOf(env[key]) === hostOf(live[key])) throw new Error(`REFUSING: ${key} is the LIVE database`);
const dbUrl = new URL(env.DIRECT_URL);
if (!(dbUrl.hostname === 'localhost' && dbUrl.port === '5433')) throw new Error('REFUSING: .env.local does not point at the local test database');

const API = 'http://localhost:3001';
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36).toUpperCase();

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const branchId = (await api('GET', '/branches', { token: owner })).json[0].id;

  const product = (await api('POST', '/products', { token: owner, body: { name: `Test Tomatoes ${tag}` } })).json;
  const variant = (await api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku: `TOM-${tag}`, price: 150, quantityMode: 'WEIGHT' } })).json;
  check('a kitchen supply is added as a product sold by weight', Boolean(variant.id) && variant.quantityMode === 'WEIGHT', variant);
  const costOf = async () => Number((await sql.query('SELECT cost FROM product_variants WHERE id = $1', [variant.id])).rows[0].cost);
  const rawCost = async () => (await sql.query('SELECT cost FROM product_variants WHERE id = $1', [variant.id])).rows[0].cost;
  const receive = (quantityDelta, extra = {}) => api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId: variant.id, type: 'ADJUSTMENT', quantityDelta, ...extra } });
  check('it starts with no cost', (await rawCost()) === null);

  section('1. A delivery with the price paid sets and then averages the cost');
  const first = await receive(10, { unitCost: 80 });
  check('10 kg at KES 80 is received', first.status === 201 && Number(first.json.unitCost) === 80, first);
  check('the cost becomes KES 80', (await costOf()) === 80);
  const second = await receive(20, { unitCost: 110 });
  check('20 kg more at KES 110 is received', second.status === 201, second);
  check('the cost is now the average of what is held: KES 100', (await costOf()) === 100, await rawCost());
  check('the stock is 30 kg', Number((await sql.query('SELECT sum(quantity) AS q FROM inventory_items WHERE "variantId" = $1', [variant.id])).rows[0].q) === 30);
  const saved = await sql.query('SELECT "unitCost" FROM inventory_transactions WHERE "variantId" = $1 ORDER BY "createdAt"', [variant.id]);
  check('what was paid is kept on each delivery', saved.rows.map((r) => Number(r.unitCost)).join() === '80,110', saved.rows);

  section('2. No price, no change; a price on something that is not a delivery is refused');
  await receive(5);
  check('a delivery with no price leaves the cost alone', (await costOf()) === 100);
  const onWaste = await api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId: variant.id, type: 'WASTE', quantityDelta: -1, unitCost: 100 } });
  check('a price on a write-off is refused', onWaste.status === 400 && /only applies when stock is received/.test(onWaste.json.message), onWaste);
  const onNegative = await receive(-2, { unitCost: 100 });
  check('a price on stock going out is refused', onNegative.status === 400, onNegative);
  check('a negative price is refused', (await receive(5, { unitCost: -1 })).status === 400);
  check('a price with 3 decimals is refused', (await receive(5, { unitCost: 10.123 })).status === 400);
  check('and none of those changed the cost', (await costOf()) === 100);

  section('3. A batch delivery with a price (35 kg held at KES 100)');
  const batch = await api('POST', '/inventory/batches', { token: owner, body: { variantId: variant.id, branchId, batchNumber: `B-${tag}`, quantityReceived: 15, unitCost: 130 } });
  check('15 kg more at KES 130 arrives as a batch', batch.status === 201, batch);
  check('the cost is the average again: (35 x 100 + 15 x 130) / 50 = KES 109', (await costOf()) === 109, await rawCost());

  section('4. A purchase order delivery');
  const supplier = (await api('POST', '/suppliers', { token: owner, body: { name: `Market ${tag}` } })).json;
  const makeOrder = async (price) => (await api('POST', '/purchase-orders', { token: owner, body: { branchId, supplierId: supplier.id, lineItems: [{ variantId: variant.id, quantityOrdered: 10, unitCost: price }] } })).json;
  const po1 = await makeOrder(90);
  const received1 = await api('POST', `/purchase-orders/${po1.id}/receive`, { token: owner, body: { lines: [{ lineItemId: po1.lineItems[0].id, quantity: 10 }] } });
  check('the order is received', received1.status === 201 || received1.status === 200, received1);
  check('with no price given, the order price (KES 90) is used: (50 x 109 + 10 x 90) / 60 = KES 105.83', Math.abs((await costOf()) - 105.83) < 0.006, await rawCost());
  const po2 = await makeOrder(90);
  const received2 = await api('POST', `/purchase-orders/${po2.id}/receive`, { token: owner, body: { lines: [{ lineItemId: po2.lineItems[0].id, quantity: 10, unitCost: 130 }] } });
  check('a second order is received', received2.status === 201 || received2.status === 200, received2);
  check('what was actually charged (KES 130) wins over the order price: (60 x 105.83 + 10 x 130) / 70 = KES 109.29', Math.abs((await costOf()) - 109.29) < 0.02, await rawCost());

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
