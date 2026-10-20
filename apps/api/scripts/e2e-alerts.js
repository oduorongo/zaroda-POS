// End-to-end test of the staff alerts feed (what the back office and till pop up and ring for) against a LOCAL test setup:
// a paid online order and a table request show up, and drop off again once dealt with. Never touches the live system.
//
// Needs running: the test Postgres (port 5433) and the API with the test settings, plus the demo seed and at least one
// online order (what scripts/e2e-online-shop.js or e2e-delivery-area.js leave behind).
//   node scripts/e2e-alerts.js
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
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('owner can sign in', Boolean(owner));

  const noToken = await api('GET', '/alerts/staff');
  check('the feed needs a sign-in', noToken.status === 401, noToken);

  const order = (await sql.query(`SELECT id, status, "orderNumber" FROM online_orders ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
  check('there is an online order to play with', Boolean(order));
  const original = order.status;
  const feed = async () => (await api('GET', '/alerts/staff', { token: owner })).json;
  const setStatus = (status) => sql.query(`UPDATE online_orders SET status = $2::"OnlineOrderStatus" WHERE id = $1`, [order.id, status]);

  await setStatus('PENDING_PAYMENT');
  check('an unpaid order does not alert', !(await feed()).items.some((i) => i.key === `order:${order.id}`));
  await setStatus('PAID');
  const paid = await feed();
  const item = paid.items.find((i) => i.key === `order:${order.id}`);
  check('a paid order alerts, with a stable key', Boolean(item), paid);
  check('it says what and where', item?.kind === 'ORDER' && item.title.includes(order.orderNumber) && item.href === '/online-orders', item);
  check('the key does not change between checks (so it rings once, not every refresh)', (await feed()).items.find((i) => i.key === `order:${order.id}`)?.key === item.key);
  await setStatus('ACCEPTED');
  check('once accepted it drops off by itself', !(await feed()).items.some((i) => i.key === `order:${order.id}`));

  // a table request
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  const table = (await sql.query(`INSERT INTO table_reservations (id, "organizationId", "branchId", "reservationNumber", status, "guestName", "guestPhone", "partySize", date, time, "shopName", "shopSlug", "guestTokenHash", "updatedAt")
     SELECT gen_random_uuid(), "organizationId", "fulfilmentBranchId", 'ZT-ALERT' || floor(random()*100000)::text, 'REQUESTED', 'Alert Tester', '254700000001', 4, (now() at time zone 'utc')::date + 1, '19:30', 'Demo', $1, 'x', now()
     FROM online_stores WHERE slug = $1 RETURNING id`, [store.slug])).rows[0];
  const withTable = await feed();
  const tableItem = withTable.items.find((i) => i.key === `reservation:${table.id}`);
  check('a table request alerts', Boolean(tableItem) && tableItem.kind === 'RESERVATION' && /Table request for 4/.test(tableItem.title) && tableItem.href === '/restaurant', withTable);
  await sql.query(`UPDATE table_reservations SET status = 'CONFIRMED' WHERE id = $1`, [table.id]);
  check('once answered it drops off', !(await feed()).items.some((i) => i.key === `reservation:${table.id}`));

  // leave things as found
  await sql.query(`DELETE FROM table_reservations WHERE id = $1`, [table.id]);
  await setStatus(original);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
