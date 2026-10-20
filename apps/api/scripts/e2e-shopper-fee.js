// End-to-end test of the shopper convenience fee against a LOCAL test setup: the fee is added to the cart and paid with the
// order, the shop pays no commission on it, the fees the shop collects roll into an invoice it sends to Zaroda, and a shop that
// leaves them unsent is hidden after 3 days. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433), the pretend Tuma (node scripts/mock-tuma.js), the API started with the test
// settings, and the demo seed with its live "demo-shop" (what scripts/e2e-online-shop.js leaves behind).
//   node scripts/e2e-shopper-fee.js
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
const MOCK = 'http://localhost:4010';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const mock = (m, p) => call(m, MOCK + p);
const sql = new Client({ connectionString: env.DIRECT_URL });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (id) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: id, scope: 'buyer', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', env.BUYER_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  check('pretend Tuma is running', (await mock('GET', '/_test/pushes')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  const slug = store.slug;
  const orgId = (await sql.query('SELECT "organizationId" AS id FROM online_stores WHERE slug = $1', [slug])).rows[0].id;
  check('the demo shop is live', Boolean(store.isPublished));
  // start clean: no leftovers from an earlier run
  await sql.query(`UPDATE online_orders SET "commissionInvoiceId" = NULL WHERE "organizationId" = $1 AND "convenienceFee" > 0`, [orgId]);
  await sql.query(`DELETE FROM commission_invoices WHERE "organizationId" = $1 AND kind = 'DAILY_FEE'`, [orgId]);
  await sql.query(`UPDATE online_orders SET "convenienceFee" = 0 WHERE "organizationId" = $1`, [orgId]);

  const id = randomUUID();
  await sql.query(`INSERT INTO buyers (id, phone, "updatedAt") VALUES ($1, $2, now())`, [id, `2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`]);
  const buyer = tokenFor(id);
  const detail = (await api('GET', `/public/shops/${slug}`)).json;
  const variant = detail.products?.flatMap((p) => p.variants)?.find((v) => v.available >= 4);
  check('the shop has something in stock', Boolean(variant));
  const order = (qty) => api('POST', '/buyer/orders', { token: buyer, body: { shopSlug: slug, lines: [{ variantId: variant.id, quantity: qty }], fulfilmentType: 'PICKUP', paymentPhone: '0722000333' } });

  section('1. The shopper sees and pays the convenience fee');
  check('the shop page tells the app the fee rate (3%)', detail.convenienceFeeRate === 0.03, detail.convenienceFeeRate);
  const placed = await order(1);
  check('an order is placed', placed.status === 201, placed);
  const o = placed.json;
  const expectedFee = Math.round(o.subtotal * 0.03);
  check(`the fee is 3% of the items, to the nearest shilling (KES ${expectedFee} on KES ${o.subtotal})`, o.convenienceFee === expectedFee, o);
  check('the shopper pays items (rounded up) plus the fee', o.amountDue === Math.ceil(o.subtotal) + expectedFee, o);
  check('the shop is charged no commission on this order', o.commissionRate === 0, o);
  const pushes = (await mock('GET', '/_test/pushes')).json;
  const push = pushes.filter((p) => (p.callback_url || '').includes(o.id)).pop();
  check('the M-Pesa prompt to the shopper is for the full amount including the fee', push?.amount === o.amountDue, push);

  section('2. The shop collects it, and knows what it is holding');
  await mock('POST', `/_test/pay/${push.merchant_request_id}`);
  await sleep(500);
  const paid = (await api('GET', `/buyer/orders/${o.id}`, { token: buyer })).json;
  check('the order is paid', paid.status === 'PAID', paid);
  const before = (await api('GET', '/online-store/me/commission', { token: owner })).json;
  check('the shop sees the fee it is holding', before.fees?.unsentTotal === expectedFee && before.fees.unsentCount === 1, before.fees);
  const commissionRow = (await sql.query('SELECT "commissionRate"::float AS r FROM online_orders WHERE id = $1', [o.id])).rows[0];
  check('and it is not on the old monthly commission track (rate 0 stored)', commissionRow.r === 0, commissionRow);
  const feed = (await api('GET', '/alerts/staff', { token: owner })).json.items;
  check('the pop-up feed lists the paid order', feed.some((i) => i.key === `order:${o.id}`), feed);

  section('3. Cancelled and unpaid orders carry no fee to send');
  const second = await order(1);
  check('a second order, left unpaid', second.status === 201);
  check('an unpaid order is not counted', (await api('GET', '/online-store/me/commission', { token: owner })).json.fees.unsentTotal === expectedFee);
  await sql.query(`UPDATE online_orders SET status = 'CANCELLED' WHERE id = $1`, [second.json.id]);
  check('nor is a cancelled one', (await api('GET', '/online-store/me/commission', { token: owner })).json.fees.unsentTotal === expectedFee);

  section('4. "Send fees now": the day\'s fees become one invoice, due at once');
  const settle = await api('POST', '/online-store/me/commission/fees/settle', { token: owner, body: {} });
  check('an invoice is made for the fees', settle.status === 200 && settle.json.kind === 'DAILY_FEE' && settle.json.amountDue === expectedFee && settle.json.status === 'ISSUED', settle);
  check('it is due at once', new Date(settle.json.dueDate).getTime() <= Date.now() + 1000, settle.json.dueDate);
  const again = await api('POST', '/online-store/me/commission/fees/settle', { token: owner, body: {} });
  check('a second tap finds nothing left to send (no double billing)', again.status === 400, again);
  const linked = await sql.query(`SELECT count(*)::int AS n FROM online_orders WHERE "commissionInvoiceId" = $1`, [settle.json.id]);
  check('the order is tied to the invoice', linked.rows[0].n === 1, linked.rows);
  const after = (await api('GET', '/online-store/me/commission', { token: owner })).json;
  check('nothing is left unsent', after.fees.unsentTotal === 0 && after.fees.unsentCount === 0, after.fees);
  const feed2 = (await api('GET', '/alerts/staff', { token: owner })).json.items;
  check('the pop-up feed now tells the shop to send the money', feed2.some((i) => i.kind === 'FEES' && i.title.includes(String(expectedFee))), feed2);

  section('5. The shop sends it to Zaroda by M-Pesa');
  const pay = await api('POST', `/online-store/me/commission/invoices/${settle.json.id}/pay`, { token: owner, body: { phone: '0711000111' } });
  check('an M-Pesa prompt is started', pay.status === 200 && !pay.json.lastPaymentError, pay);
  const zPush = (await mock('GET', '/_test/pushes')).json.filter((p) => (p.callback_url || '').includes(`/public/commission/`)).pop();
  check('the prompt is for the fees and goes to Zaroda', zPush?.amount === expectedFee, zPush);
  await mock('POST', `/_test/pay/${zPush.merchant_request_id}`);
  await sleep(500);
  const settled = (await api('GET', '/online-store/me/commission', { token: owner })).json.invoices.find((i) => i.id === settle.json.id);
  check('the invoice turns Paid by itself', settled?.status === 'PAID', settled);

  section('6. Fees left unsent for 3 days hide the shop');
  const makeOverdue = async (days) => {
    await sql.query(`DELETE FROM commission_invoices WHERE "organizationId" = $1 AND "invoiceNumber" = 'ZF-TEST-OVERDUE'`, [orgId]);
    await sql.query(
      `INSERT INTO commission_invoices (id, "organizationId", "invoiceNumber", kind, "periodMonth", "periodStart", "periodEnd", "orderCount", "salesTotal", "commissionTotal", "amountDue", status, "issuedAt", "dueDate", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'ZF-TEST-OVERDUE', 'DAILY_FEE', 'test#1', now(), now(), 1, 100, 3, 3, 'ISSUED', now() at time zone 'utc' - ($2 || ' days')::interval, now() at time zone 'utc' - ($2 || ' days')::interval, now())`,
      [orgId, String(days)],
    );
  };
  await makeOverdue(2);
  check('2 days unsent: the shop is still on the marketplace', (await api('GET', `/public/shops/${slug}`)).status === 200);
  await makeOverdue(4);
  check('4 days unsent: the shop is hidden', (await api('GET', `/public/shops/${slug}`)).status === 404);
  const hiddenFeed = (await api('GET', '/alerts/staff', { token: owner })).json.items.find((i) => i.kind === 'FEES');
  check('and the pop-up says so', /hidden/.test(hiddenFeed?.body || ''), hiddenFeed);
  await sql.query(`UPDATE commission_invoices SET status = 'PAID', "paidAt" = now() WHERE "invoiceNumber" = 'ZF-TEST-OVERDUE'`);
  check('once sent, the shop is back', (await api('GET', `/public/shops/${slug}`)).status === 200);
  await sql.query(`DELETE FROM commission_invoices WHERE "invoiceNumber" = 'ZF-TEST-OVERDUE'`);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
