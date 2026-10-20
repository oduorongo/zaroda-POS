// End-to-end test of "a shop only delivers to the counties it serves" against a LOCAL test setup: a Migori shopper cannot
// get delivery from a Nairobi shop, a Kisii shopper cannot get delivery from a Mombasa shop, pickup is never limited, and
// the shop can list the counties it serves. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433), the pretend Tuma (node scripts/mock-tuma.js), the API started with the
// test settings, and the demo seed with its live "demo-shop" (what scripts/e2e-online-shop.js leaves behind).
//   node scripts/e2e-delivery-area.js
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
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (id) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: id, scope: 'buyer', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', env.BUYER_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

(async () => {
  await sql.connect();
  // Checkout is limited per minute: when this is run straight after another order test, set WAIT_SECONDS=65.
  if (process.env.WAIT_SECONDS) await new Promise((r) => setTimeout(r, Number(process.env.WAIT_SECONDS) * 1000));
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  const slug = store.slug;
  const branchId = store.fulfilmentBranchId;
  check('the demo shop is live with a branch', Boolean(store.isPublished && branchId), store);
  const original = (await sql.query('SELECT county FROM branches WHERE id = $1', [branchId])).rows[0].county;
  const setBranchCounty = (county) => sql.query('UPDATE branches SET county = $2 WHERE id = $1', [branchId, county]);

  const id = randomUUID();
  await sql.query(`INSERT INTO buyers (id, phone, "updatedAt") VALUES ($1, $2, now())`, [id, `2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`]);
  const buyer = tokenFor(id);
  const detail = () => api('GET', `/public/shops/${slug}`);
  const variantId = (await detail()).json.products?.flatMap((p) => p.variants)?.find((v) => v.available >= 6)?.id;
  check('the shop has something in stock to order', Boolean(variantId));
  const order = (extra) => api('POST', '/buyer/orders', { token: buyer, body: { shopSlug: slug, lines: [{ variantId, quantity: 1 }], paymentPhone: '0722000333', ...extra } });
  const delivery = (county) => order({ fulfilmentType: 'DELIVERY', deliveryAddress: 'Somewhere nice 12', ...(county === undefined ? {} : { deliveryCounty: county }) });

  section('1. A Nairobi shop delivers only in Nairobi');
  const turnOn = await api('PATCH', '/online-store/me', { token: owner, body: { deliveryEnabled: true, deliveryCounties: [] } });
  check('delivery switched on with no counties listed', turnOn.status === 200 && turnOn.json.deliveryEnabled === true, turnOn);
  await setBranchCounty('nairobi county');
  const shop1 = (await detail()).json;
  check('the shop page says it serves Nairobi (its branch county, tidied up)', JSON.stringify(shop1.deliveryCounties) === '["Nairobi"]' && shop1.location?.county === 'Nairobi', { counties: shop1.deliveryCounties, loc: shop1.location });
  const dir = (await api('GET', '/public/shops')).json.find?.((s) => s.slug === slug);
  check('the shop directory says so too', JSON.stringify(dir?.deliveryCounties) === '["Nairobi"]' && dir?.county === 'Nairobi', dir);

  const none = await delivery();
  check('delivery with no county chosen is refused', none.status === 400 && /Choose the county/.test(none.json.message), none);
  const migori = await delivery('Migori');
  check('a Migori shopper is refused delivery from the Nairobi shop', migori.status === 400 && /only delivers in Nairobi/.test(migori.json.message) && /cannot deliver to Migori/.test(migori.json.message), migori);
  const kisii = await delivery('kisii');
  check('a Kisii shopper is refused too, however it is typed', kisii.status === 400, kisii);
  const nonsense = await delivery('Westlands');
  check('something that is not a county is refused', nonsense.status === 400, nonsense);
  const pickup = await order({ fulfilmentType: 'PICKUP' });
  check('pickup is never limited by distance', pickup.status === 201, pickup);
  const nairobi = await delivery('nairobi');
  check('a Nairobi shopper gets delivery', nairobi.status === 201, nairobi);
  check('the order remembers the delivery county', nairobi.json.deliveryCounty === 'Nairobi', nairobi.json);

  section('2. The shop lists the counties it serves');
  const bad = await api('PATCH', '/online-store/me', { token: owner, body: { deliveryCounties: ['Migori', 'Atlantis'] } });
  check('a made-up county is refused', bad.status === 400 && /Atlantis/.test(bad.json.message), bad);
  const listed = await api('PATCH', '/online-store/me', { token: owner, body: { deliveryCounties: ['migori', 'Kisii County', 'migori'] } });
  check('real counties are saved, tidied and de-duplicated', listed.status === 200 && JSON.stringify(listed.json.deliveryCounties) === '["Migori","Kisii"]', listed.json.deliveryCounties);
  check('the shop page now lists them', JSON.stringify((await detail()).json.deliveryCounties) === '["Migori","Kisii"]');
  check('Migori now gets delivery', (await delivery('Migori')).status === 201);
  check('Kisii now gets delivery', (await delivery('Kisii')).status === 201);
  const nairobiNow = await delivery('Nairobi');
  check('Nairobi no longer does (the shop moved its area)', nairobiNow.status === 400 && /Kisii and Migori|Migori and Kisii/.test(nairobiNow.json.message), nairobiNow);
  check('a shop with the same list still lets pickup through from anywhere', (await order({ fulfilmentType: 'PICKUP' })).status === 201);

  console.log('  (waiting a minute for the checkout allowance)');
  await new Promise((r) => setTimeout(r, 62000));
  section('3. An older shop that has not set its area is not locked out');
  await api('PATCH', '/online-store/me', { token: owner, body: { deliveryCounties: [] } });
  await setBranchCounty('Somewhere nice');
  const legacy = (await detail()).json;
  check('its area is unknown, so the page says "not limited"', legacy.deliveryCounties === null, legacy.deliveryCounties);
  const legacyOrder = await delivery('Migori');
  check('delivery still works until it sets an area', legacyOrder.status === 201, legacyOrder);

  // leave the demo shop as we found it
  await setBranchCounty(original);
  await api('PATCH', '/online-store/me', { token: owner, body: { deliveryCounties: [] } });

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
