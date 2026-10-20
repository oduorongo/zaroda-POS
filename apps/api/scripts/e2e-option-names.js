// End-to-end test of product option names ("Large loaf 800g") against a LOCAL test setup: a product gets two named options,
// the shop shows the names, and an order line keeps the readable title. Never touches the live system (refuses unless the
// database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations, the pretend Tuma, the API with the test settings,
// and the demo seed with its live "demo-shop".
//   node scripts/e2e-option-names.js
const fs = require('fs');
const path = require('path');
const { createHmac, randomUUID } = require('crypto');

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
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (id) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: id, scope: 'buyer', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', env.BUYER_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  const branchId = store.fulfilmentBranchId;
  const slug = store.slug;

  section('1. A product with two named options');
  const product = (await api('POST', '/products', { token: owner, body: { name: `Test Bread ${tag}` } })).json;
  await api('PATCH', `/products/${product.id}`, { token: owner, body: { onlineVisible: true } });
  const small = await api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku: `BR-S-${tag}`, name: '  Small loaf 400g ', price: 60, cost: 40 } });
  const large = await api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku: `BR-L-${tag}`, name: 'Large loaf 800g', price: 110 } });
  check('both options are created', small.status === 201 && large.status === 201, [small.json, large.json]);
  check('the name is tidied (spaces trimmed)', small.json.name === 'Small loaf 400g', small.json);
  check('an option can be created with a cost', Number(small.json.cost) === 40);
  const unnamed = await api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku: `BR-X-${tag}`, price: 30 } });
  check('an option does not need a name', unnamed.status === 201 && unnamed.json.name === null, unnamed.json);
  const tooLong = await api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku: `BR-Y-${tag}`, name: 'x'.repeat(61), price: 30 } });
  check('a name over 60 characters is refused', tooLong.status === 400, tooLong);

  section('2. Renaming, pricing and costing an option afterwards');
  const renamed = await api('PATCH', `/products/${product.id}/variants/${large.json.id}`, { token: owner, body: { name: 'Family loaf 800g', price: 115, cost: 70 } });
  check('name, price and cost can be changed', renamed.status === 200 && renamed.json.name === 'Family loaf 800g' && Number(renamed.json.price) === 115 && Number(renamed.json.cost) === 70, renamed);
  const priceOnly = await api('PATCH', `/products/${product.id}/variants/${large.json.id}`, { token: owner, body: { price: 112 } });
  check('changing only the price leaves the name alone', priceOnly.json.name === 'Family loaf 800g' && Number(priceOnly.json.price) === 112, priceOnly.json);
  const cleared = await api('PATCH', `/products/${product.id}/variants/${unnamed.json.id}`, { token: owner, body: { name: '   ' } });
  check('a blank name means no name', cleared.status === 200 && cleared.json.name === null, cleared.json);
  await api('PATCH', `/products/${product.id}/variants/${large.json.id}`, { token: owner, body: { name: 'Large loaf 800g', price: 110 } });

  section('3. The shop shows the names, and the order keeps the readable title');
  for (const v of [small.json, large.json]) await api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId: v.id, type: 'ADJUSTMENT', quantityDelta: 10 } });
  const shop = (await api('GET', `/public/shops/${slug}`)).json;
  const shown = shop.products?.find((p) => p.id === product.id);
  check('the shop lists the named options with their names (and the unnamed one with none)', shown?.variants.map((v) => v.name).filter(Boolean).sort().join('|') === 'Large loaf 800g|Small loaf 400g', shown?.variants);
  const id = randomUUID();
  await sql.query(`INSERT INTO buyers (id, phone, "updatedAt") VALUES ($1, $2, now())`, [id, `2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`]);
  const buyer = tokenFor(id);
  const order = await api('POST', '/buyer/orders', { token: buyer, body: { shopSlug: slug, lines: [{ variantId: large.json.id, quantity: 2 }, { variantId: small.json.id, quantity: 1 }], fulfilmentType: 'PICKUP', paymentPhone: '0722000333' } });
  check('an order for both is placed', order.status === 201, order);
  const titles = order.json.lines?.map((l) => l.productName).sort();
  check('each line carries the product and option name', JSON.stringify(titles) === JSON.stringify([`Test Bread ${tag} - Large loaf 800g`, `Test Bread ${tag} - Small loaf 400g`].sort()), titles);
  await api('PATCH', `/products/${product.id}/variants/${large.json.id}`, { token: owner, body: { name: 'Jumbo loaf' } });
  const again = (await api('GET', `/buyer/orders/${order.json.id}`, { token: buyer })).json;
  check('renaming an option later does not rewrite old orders', again.lines.some((l) => l.productName.endsWith('Large loaf 800g')), again.lines.map((l) => l.productName));

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
