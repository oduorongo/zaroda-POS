// End-to-end test of the Online Shop against a LOCAL test setup. Plays a shop
// owner, two shoppers, an attacker and the platform admin, and checks each
// step. It never touches the live system: it refuses to run unless the
// database in .env.local is on this computer and Tuma is the pretend one.
//
// Needs running: the test Postgres (port 5433), the pretend Tuma
// (node scripts/mock-tuma.js), and the API started with
// `pnpm --filter api start:test`, plus the demo seed (prisma db seed) and a
// test platform admin. See the online-shop test notes for the one-time setup.
//
//   node scripts/e2e-online-shop.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR, 'C:/Users/user/OneDrive/Desktop/zaroda  school/backend'] }));

const readEnv = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};
// Same two switches as scripts/with-env-local.js: by default the database must be on this
// computer; for a rehearsal against a COPY of the live database, name the copy's host.
const ENV_FILE = process.env.ENV_FILE || '.env.local';
const env = readEnv(path.join(API_DIR, ENV_FILE));
const live = readEnv(path.join(API_DIR, '.env'));
const hostOf = (url) => new URL(url).hostname.replace(/-pooler/, '');
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (live[key] && hostOf(env[key]) === hostOf(live[key])) throw new Error(`REFUSING: ${key} in ${ENV_FILE} is the LIVE database`);
}
const dbUrl = new URL(env.DIRECT_URL);
const isLocal = dbUrl.hostname === 'localhost' && dbUrl.port === '5433';
const isNamedCopy = Boolean(process.env.ALLOW_DB_HOST) && hostOf(env.DIRECT_URL) === process.env.ALLOW_DB_HOST.replace(/-pooler/, '');
if (!isLocal && !isNamedCopy) throw new Error(`REFUSING: ${ENV_FILE} does not point at the local test database (or at the copy named in ALLOW_DB_HOST)`);
if (!/^http:\/\/localhost:\d+$/.test(env.TUMA_BASE_URL || '')) throw new Error('REFUSING: TUMA_BASE_URL is not a local pretend Tuma');

const API = 'http://localhost:3001';
const MOCK = 'http://localhost:4010';
const API_LOG = process.argv[2] || path.join(os.tmpdir(), 'test-api.log');

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : ''}`);
  }
}
const section = (title) => console.log(`\n${title}`);

async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}
const api = (method, p, opts) => call(method, API + p, opts);
const mock = (method, p) => call(method, MOCK + p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = new Client({ connectionString: env.DIRECT_URL });

// `who` is { email } or { phone }. With no email/SMS provider configured the API (in development)
// writes the code to its log, which is where this reads it from.
async function buyerLogin(who) {
  const label = who.email ?? who.phone;
  const request = await api('POST', '/buyer-auth/request-code', { body: who });
  check(`buyer ${label}: code requested by ${who.email ? 'email' : 'SMS'}`, request.status === 200 && request.json.channel === (who.email ? 'EMAIL' : 'SMS'), request);
  await sleep(500);
  const log = fs.readFileSync(API_LOG, 'utf8');
  const codes = [...log.matchAll(/Dev login code for (\S+): (\d{6})/g)].filter((m) => m[1] === request.json.identifier);
  const code = codes.length ? codes[codes.length - 1][2] : null;
  check(`buyer ${label}: code found in the API log (dev mode, nothing really sent)`, Boolean(code));
  return { code, identifier: request.json.identifier };
}

async function riderLogin(email) {
  const request = await api('POST', '/rider-auth/request-code', { body: { email } });
  check(`rider ${email}: code requested by email`, request.status === 200 && request.json.email === email, request);
  await sleep(500);
  const log = fs.readFileSync(API_LOG, 'utf8');
  const codes = [...log.matchAll(/Dev rider login code for (\S+): (\d{6})/g)].filter((m) => m[1] === email);
  const code = codes.length ? codes[codes.length - 1][2] : null;
  check(`rider ${email}: code found in the API log (dev mode, nothing really sent)`, Boolean(code));
  return code;
}

// Delivery emails: no email provider is configured in testing, so each one leaves a "was not sent" line
// in the API log naming the recipient - which is enough to prove WHO would have been emailed, and when.
const logMark = () => fs.statSync(API_LOG).size;
async function mailedSince(mark) {
  await sleep(700); // the emails are sent after the response, in the background
  const text = fs.readFileSync(API_LOG).subarray(mark).toString('utf8');
  return [...text.matchAll(/Delivery email to (\S+) was not sent/g)].map((m) => m[1]);
}

(async () => {
  await sql.connect();

  section('1. Start-up');
  const ready = await api('GET', '/ready');
  check('API ready and talking to the test database', ready.status === 200, ready);
  const mockUp = await mock('GET', '/_test/pushes');
  check('pretend Tuma is running', mockUp.status === 200);

  section('2. Owner, platform admin and the paid add-on');
  const ownerLogin = await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } });
  const owner = ownerLogin.json.accessToken;
  check('shop owner can log in', Boolean(owner), ownerLogin);
  const org = await api('GET', '/organizations/me', { token: owner });
  const orgId = org.json.id;
  const adminLogin = await api('POST', '/platform-admin/auth/login', { body: { email: 'admin@test.local', password: 'test-admin-password' } });
  const admin = adminLogin.json.accessToken;
  check('platform admin can log in', Boolean(admin), adminLogin);

  const before = await api('GET', '/online-store/me', { token: owner });
  check('add-on starts OFF for the business', before.json.addonActive === false);
  const selfEnable = await api('PATCH', '/online-store/me', { token: owner, body: { addonActive: true } });
  check('a business can NOT switch the add-on on for itself', selfEnable.status === 400, selfEnable);
  const stillOff = await api('PATCH', '/online-store/me', { token: owner, body: { displayName: 'x' } });
  check('settings are refused while the add-on is off', stillOff.status === 403, stillOff);
  const enable = await api('PATCH', `/platform-admin/organizations/${orgId}/online-store`, { token: admin, body: { addonActive: true } });
  check('platform admin turns the add-on on', enable.status === 200 && enable.json.addonActive === true, enable);

  section('3. Products and stock');
  const branches = await api('GET', '/branches', { token: owner });
  const branchId = branches.json[0].id;
  const product = await api('POST', '/products', { token: owner, body: { name: 'Test Maize Flour 2kg' } });
  const productId = product.json.id;
  check('product created', Boolean(productId), product);
  const patch = await api('PATCH', `/products/${productId}`, { token: owner, body: { onlineVisible: true, onlineDescription: 'Fresh sifted maize flour.' } });
  check('product marked "show online" with a description', patch.status === 200 && patch.json.onlineVisible === true, patch);
  const variant = await api('POST', `/products/${productId}/variants`, { token: owner, body: { sku: 'MF-2KG', price: 250 } });
  const variantId = variant.json.id;
  check('variant created at KES 250', Boolean(variantId), variant);
  const stock = await api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId, type: 'ADJUSTMENT', quantityDelta: 20 } });
  check('20 units of stock received', stock.status === 201 || stock.status === 200, stock);

  section('4. Shop setup and going live');
  const wrongKey = await api('POST', '/online-store/me/tuma', { token: owner, body: { email: 'shop@test.local', apiKey: 'wrong-key' } });
  check('a wrong Tuma key is rejected before saving', wrongKey.status === 400, wrongKey);
  const early = await api('PATCH', '/online-store/me', { token: owner, body: { isPublished: true } });
  check('cannot go live before the shop is set up', early.status === 400, early);
  const connect = await api('POST', '/online-store/me/tuma', { token: owner, body: { email: 'shop@test.local', apiKey: 'shop-test-key-123' } });
  check('Tuma connects with a valid key', connect.status === 201 || connect.status === 200, connect);
  check('the API key is never returned to the browser', !JSON.stringify(connect.json).includes('shop-test-key-123') && connect.json.tumaConnected === true);
  const settings = await api('PATCH', '/online-store/me', {
    token: owner,
    body: { slug: 'demo-shop', displayName: 'Demo Shop', contactPhone: '0711000111', fulfilmentBranchId: branchId, pickupEnabled: true, isPublished: true },
  });
  check('shop goes live', settings.status === 200 && settings.json.isPublished === true, settings);
  const encryptedInDb = await sql.query(`SELECT "tumaApiKeyEncrypted" AS k FROM online_stores WHERE "organizationId" = $1`, [orgId]);
  check('the stored Tuma key is encrypted, not plain text', /^v1:/.test(encryptedInDb.rows[0].k) && !encryptedInDb.rows[0].k.includes('shop-test-key-123'));

  section('5. What the public sees');
  const list = await api('GET', '/public/shops');
  check('the shop appears in the marketplace list', list.json.some && list.json.some((s) => s.slug === 'demo-shop'), list);
  const shop = await api('GET', '/public/shops/demo-shop');
  check('the shop page shows the product with live stock of 20', shop.json.products?.[0]?.variants?.[0]?.available === 20, shop.json.products);
  check('nothing secret leaks into the public shop page', !/tuma|apiKey|encrypted/i.test(JSON.stringify(shop.json)));
  const missing = await api('GET', '/public/shops/no-such-shop');
  check('an unknown shop is a clean 404', missing.status === 404);

  section('6. Shopper A buys (signs in by EMAIL)');
  const methods = await api('GET', '/buyer-auth/methods');
  check('the sign-in screen is told email is available, and SMS is not (not set up here)', methods.json.email === true && methods.json.sms === false, methods.json);
  const badEmail = await api('POST', '/buyer-auth/request-code', { body: { email: 'not-an-email' } });
  check('an invalid email address is refused', badEmail.status === 400, badEmail);
  const both = await api('POST', '/buyer-auth/request-code', { body: { email: 'a@b.co', phone: '0712345678' } });
  check('giving both an email and a phone number is refused', both.status === 400, both);
  const A_EMAIL = 'shopper.a@example.test';
  const a = await buyerLogin({ email: A_EMAIL });
  const wrongCode = await api('POST', '/buyer-auth/verify', { body: { email: A_EMAIL, code: a.code === '000000' ? '111111' : '000000' } });
  check('a wrong emailed code is refused', wrongCode.status === 401, wrongCode);
  const otherAddress = await api('POST', '/buyer-auth/verify', { body: { email: 'someone.else@example.test', code: a.code } });
  check('the same code does not work for a different email address', otherAddress.status === 401, otherAddress);
  const aVerify = await api('POST', '/buyer-auth/verify', { body: { email: A_EMAIL, code: a.code } });
  const buyerA = aVerify.json.accessToken;
  check('shopper A signs in with the right code (account made from the email, no phone yet)', Boolean(buyerA) && aVerify.json.buyer.email === A_EMAIL && aVerify.json.buyer.phone === null, aVerify);
  const reuse = await api('POST', '/buyer-auth/verify', { body: { email: A_EMAIL, code: a.code } });
  check('a code cannot be used twice', reuse.status === 401, reuse);

  const noPhone = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  check('an email shopper must give the M-Pesa number they will pay with', noPhone.status === 400 && /M-Pesa phone number/.test(noPhone.json.message || ''), noPhone);
  const tooMany = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 25 }], fulfilmentType: 'PICKUP', paymentPhone: '0722000333' } });
  check('ordering more than the stock is refused', tooMany.status === 409, tooMany);
  const delivery = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'DELIVERY', deliveryAddress: 'Somewhere nice 12', paymentPhone: '0722000333' } });
  check('delivery is refused when the shop does not offer it', delivery.status === 400, delivery);
  const noAuth = await api('POST', '/buyer/orders', { body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  check('ordering without signing in is refused', noAuth.status === 401, noAuth);
  const staffToken = await api('GET', '/buyer/me', { token: owner });
  check('a shop owner\'s staff token does not work on buyer routes', staffToken.status === 401, staffToken);

  const order1 = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 2 }], fulfilmentType: 'PICKUP', paymentPhone: '0722000333' } });
  const o1 = order1.json;
  check('order for 2 units placed: KES 500, waiting for payment', order1.status === 201 && o1.status === 'PENDING_PAYMENT' && o1.amountDue === 500, order1);
  const pushes1 = (await mock('GET', '/_test/pushes')).json;
  const push1 = pushes1[pushes1.length - 1];
  check('an M-Pesa prompt for KES 500 was sent to the shopper\'s phone', push1?.amount === 500 && push1.phone === '254722000333', push1);
  check('the payment callback address is the secret, signed one', /\/public\/online-orders\/[0-9a-f-]+\/[0-9a-f-]+\/tuma-callback\/[A-Za-z0-9_-]{30,}$/.test(push1?.callback_url || ''), push1?.callback_url);

  const meA = await api('GET', '/buyer/me', { token: buyerA });
  check('the M-Pesa number given at checkout is remembered on the shopper\'s account', meA.json.phone === '254722000333', meA.json);

  const held = await api('GET', '/public/shops/demo-shop');
  check('the 2 units are held, so only 18 show as available', held.json.products[0].variants[0].available === 18);

  section('7. An attacker tries to fake a payment');
  const statusCalls = async () => (await mock('GET', '/_test/status-calls')).json.count;
  const checksBefore = await statusCalls();
  const forgedBadToken = await call('POST', push1.callback_url.replace(/[^/]+$/, 'not-the-real-token'), { body: { status: 'completed', amount: 500, mpesa_receipt_number: 'FAKE1' } });
  check('a callback on a made-up address is rejected outright', forgedBadToken.status === 404, forgedBadToken);
  const claim = await mock('POST', `/_test/forge/${push1.merchant_request_id}?mode=no-receipt`);
  check('(a callback arrives claiming success - with no M-Pesa receipt and nothing paid)', claim.status === 200);
  const afterClaim = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('the API did not believe it: the order is still UNPAID', afterClaim.json.status === 'PENDING_PAYMENT', afterClaim.json);
  check('it asked Tuma once (the paid backup), and Tuma said "not paid"', (await statusCalls()) === checksBefore + 1);
  const under = await mock('POST', `/_test/forge/${push1.merchant_request_id}?mode=underpay`);
  check('(a callback arrives with a receipt but only KES 1 of the KES 500)', under.status === 200);
  const afterUnder = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('an underpayment does not release the order, and is flagged', afterUnder.json.status === 'PENDING_PAYMENT' && /doesn't match/.test(afterUnder.json.lastPaymentError || ''), afterUnder.json);
  const opened = await statusCalls();
  await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  await api('GET', '/buyer/orders', { token: buyerA });
  check('merely opening the order or the order list spends nothing with Tuma', (await statusCalls()) === opened);

  section('8. The real payment arrives');
  const checksBeforePay = await statusCalls();
  const paid = await mock('POST', `/_test/pay/${push1.merchant_request_id}`);
  check('shopper pays; Tuma calls back and the API accepts it', paid.status === 200 && paid.json.callbackAnsweredWith === 200, paid.json);
  const afterPay = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('the order is now PAID with the M-Pesa receipt', afterPay.json.status === 'PAID' && /^QTEST/.test(afterPay.json.mpesaReceiptNumber || ''), afterPay.json);
  check('the normal payment path made NO paid status checks (Tuma callbacks are free)', (await statusCalls()) === checksBeforePay);
  await mock('POST', `/_test/pay/${push1.merchant_request_id}`);
  const afterReplay = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('the same payment replayed changes nothing', afterReplay.json.status === 'PAID' && afterReplay.json.mpesaReceiptNumber === afterPay.json.mpesaReceiptNumber);
  const receipts = await sql.query(`SELECT count(*)::int AS n FROM online_orders WHERE "mpesaReceiptNumber" = $1`, [afterPay.json.mpesaReceiptNumber]);
  check('one M-Pesa receipt belongs to exactly one order', receipts.rows[0].n === 1);

  section('9. Privacy between shoppers');
  const b = await buyerLogin({ phone: '0733000444' }); // by SMS, so both sign-in routes stay covered
  const bVerify = await api('POST', '/buyer-auth/verify', { body: { phone: '0733000444', code: b.code } });
  const buyerB = bVerify.json.accessToken;
  check('shopper B signs in', Boolean(buyerB), bVerify);
  const peek = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerB });
  check('shopper B cannot open shopper A\'s order', peek.status === 404, peek);
  const bList = await api('GET', '/buyer/orders', { token: buyerB });
  check('shopper B\'s own order list is empty', Array.isArray(bList.json) && bList.json.length === 0, bList);
  const bCancel = await api('POST', `/buyer/orders/${o1.id}/cancel`, { token: buyerB });
  check('shopper B cannot cancel it either', bCancel.status === 404, bCancel);

  section('10. The shop handles the order');
  const queue = await api('GET', '/online-orders', { token: owner });
  check('the order is in the shop\'s queue', queue.json.some && queue.json.some((o) => o.id === o1.id && o.status === 'PAID'), queue);
  const accept = await api('POST', `/online-orders/${o1.id}/accept`, { token: owner });
  check('shop accepts the order', accept.json.status === 'ACCEPTED', accept);
  const inv = await sql.query(`SELECT quantity::float AS q FROM inventory_items WHERE "variantId" = $1`, [variantId]);
  check('stock really drops from 20 to 18', inv.rows[0].q === 18, inv.rows);
  const sale1 = await sql.query(
    `SELECT s.id, s.status, s.total::float AS total, t."deviceLabel" AS terminal, p.method, p."providerReference" AS receipt, p.amount::float AS paid,
            (SELECT count(*)::int FROM sale_line_items WHERE "saleId" = s.id) AS lines, o."saleId" AS linked
       FROM sales s JOIN terminals t ON t.id = s."terminalId" JOIN sale_payments p ON p."saleId" = s.id
       JOIN online_orders o ON o."saleId" = s.id
      WHERE s."clientId" = $1`,
    ['online-order-' + o1.id],
  );
  const s1 = sale1.rows[0];
  check('accepting also records a normal completed sale, M-Pesa, KES 500, with the receipt, filed under "Online shop"',
    sale1.rows.length === 1 && s1.status === 'COMPLETED' && s1.total === 500 && s1.paid === 500 && s1.method === 'MPESA' && s1.terminal === 'Online shop' && s1.lines === 1 && s1.receipt === accept.json.mpesaReceiptNumber && s1.linked === s1.id,
    sale1.rows);
  const salesList = await api('GET', '/sales', { token: owner });
  check('the sale shows up in the normal Sales list the business already uses', Array.isArray(salesList.json) && salesList.json.some((s) => s.id === s1.id), { status: salesList.status });
  const markedReady = await api('POST', `/online-orders/${o1.id}/ready`, { token: owner });
  check('marked ready for pickup', markedReady.json.status === 'READY');
  const complete = await api('POST', `/online-orders/${o1.id}/complete`, { token: owner });
  check('collected: order completed, 3% commission recorded = KES 15', complete.json.status === 'COMPLETED' && complete.json.commissionAmount === 15, complete.json);
  const again = await api('POST', `/online-orders/${o1.id}/accept`, { token: owner });
  check('an order cannot be accepted twice', again.status === 400, again);
  const salesFor1 = await sql.query(`SELECT count(*)::int AS n FROM sales WHERE "clientId" = $1`, ['online-order-' + o1.id]);
  check('and it still has exactly one sale', salesFor1.rows[0].n === 1, salesFor1.rows);

  section('11. Payment whose callback never arrives (the buyer\'s "check now" backup)');
  const order2 = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  const o2 = order2.json;
  check('shopper B places a KES 250 order', order2.status === 201 && o2.amountDue === 250, order2);
  const pushes2 = (await mock('GET', '/_test/pushes')).json;
  const push2 = pushes2[pushes2.length - 1];
  await mock('POST', `/_test/pay-silent/${push2.merchant_request_id}`);
  const quiet = await statusCalls();
  const idle = await api('GET', `/buyer/orders/${o2.id}`, { token: buyerB });
  check('Tuma never called back, and just opening the order does NOT find the payment (and costs nothing)', idle.json.status === 'PENDING_PAYMENT' && (await statusCalls()) === quiet, idle.json);
  const press = await api('POST', `/buyer/orders/${o2.id}/check`, { token: buyerB });
  check('pressing "I\'ve paid - check now" finds it (one paid check)', press.json.status === 'PAID' && press.json.checkResult === 'paid' && (await statusCalls()) === quiet + 1, press.json);
  await api('POST', `/online-orders/${o2.id}/accept`, { token: owner });
  const complete2 = await api('POST', `/online-orders/${o2.id}/complete`, { token: owner });
  check('second order completed (commission KES 7.50)', complete2.json.status === 'COMPLETED' && complete2.json.commissionAmount === 7.5, complete2.json);

  section('11b. The shop confirms a payment by hand');
  const order4 = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  const manual4 = await api('POST', `/online-orders/${order4.json.id}/confirm-payment`, { token: owner, body: { receipt: 'abc' } });
  check('a made-up short code is refused', manual4.status === 400, manual4);
  const confirmed = await api('POST', `/online-orders/${order4.json.id}/confirm-payment`, { token: owner, body: { receipt: 'sjk1abc2de' } });
  check('the shop marks it paid with the M-Pesa code from its message', confirmed.json.status === 'PAID' && confirmed.json.mpesaReceiptNumber === 'SJK1ABC2DE', confirmed.json);
  const order5 = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  const reused = await api('POST', `/online-orders/${order5.json.id}/confirm-payment`, { token: owner, body: { receipt: 'SJK1ABC2DE' } });
  check('the same M-Pesa code cannot release a second order', reused.status === 409, reused);
  const alreadyPaid = await api('POST', `/online-orders/${order4.json.id}/confirm-payment`, { token: owner, body: { receipt: 'ZZZ9YYY8XX' } });
  check('an order that is already paid cannot be marked paid again', alreadyPaid.status === 400, alreadyPaid);
  // Cancelling AFTER acceptance takes the sale back out (reuses this paid order - no extra checkout, which is rate limited).
  const stockBefore4 = (await sql.query(`SELECT quantity::float AS q FROM inventory_items WHERE "variantId" = $1`, [variantId])).rows[0].q;
  await api('POST', `/online-orders/${order4.json.id}/accept`, { token: owner });
  const sale4 = await sql.query(`SELECT status FROM sales WHERE "clientId" = $1`, ['online-order-' + order4.json.id]);
  const stockAccepted4 = (await sql.query(`SELECT quantity::float AS q FROM inventory_items WHERE "variantId" = $1`, [variantId])).rows[0].q;
  check('an accepted order has a completed sale (and took 1 off the stock)', sale4.rows.length === 1 && sale4.rows[0].status === 'COMPLETED' && stockAccepted4 === stockBefore4 - 1, { sale: sale4.rows, stockBefore4, stockAccepted4 });
  const cancel4 = await api('POST', `/online-orders/${order4.json.id}/cancel`, { token: owner, body: { reason: 'test clean-up' } });
  const sale4b = await sql.query(`SELECT status FROM sales WHERE "clientId" = $1`, ['online-order-' + order4.json.id]);
  const stockAfter4 = (await sql.query(`SELECT quantity::float AS q FROM inventory_items WHERE "variantId" = $1`, [variantId])).rows[0].q;
  check('cancelling it voids the sale and puts the stock back', cancel4.json.status === 'CANCELLED' && sale4b.rows[0].status === 'VOIDED' && stockAfter4 === stockBefore4, { cancel: cancel4.json.status, sale: sale4b.rows, stockBefore4, stockAfter4 });
  await api('POST', `/online-orders/${order5.json.id}/cancel`, { token: owner, body: { reason: 'test clean-up' } });

  section('12. Cancelling');
  const order3 = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 3 }], fulfilmentType: 'PICKUP' } });
  const heldBefore = (await api('GET', '/public/shops/demo-shop')).json.products[0].variants[0].available;
  const firstCheck = await api('POST', `/buyer/orders/${order3.json.id}/check`, { token: buyerB });
  check('"check now" on an unpaid order says "not received yet"', firstCheck.json.checkResult === 'not-paid-yet', firstCheck.json);
  const secondCheck = await api('POST', `/buyer/orders/${order3.json.id}/check`, { token: buyerB });
  check('pressing it again straight away is refused (each check costs the shop KES 1)', secondCheck.status === 400 && /wait about 30 seconds/.test(secondCheck.json.message || ''), secondCheck);
  const cancel = await api('POST', `/buyer/orders/${order3.json.id}/cancel`, { token: buyerB });
  check('shopper cancels an unpaid order', cancel.json.status === 'CANCELLED', cancel);
  const heldAfter = (await api('GET', '/public/shops/demo-shop')).json.products[0].variants[0].available;
  check('the held stock is released again', heldAfter === heldBefore + 3, { heldBefore, heldAfter });

  section('13. Monthly commission invoice (automatic)');
  // Pretend both orders were completed last month, so the month is closed.
  const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15, 10, 0, 0));
  await sql.query(`UPDATE online_orders SET "completedAt" = $1 WHERE status = 'COMPLETED'`, [lastMonth]);
  const nothingYet = await api('GET', '/online-store/me/commission', { token: owner });
  check('before billing: 2 completed orders, KES 22.50 building up, no invoice', nothingYet.json.unbilled?.orderCount === 2 && nothingYet.json.unbilled.commissionTotal === 22.5 && nothingYet.json.invoices.length === 0, nothingYet.json);
  const run = await api('POST', '/platform-admin/commission/run', { token: admin });
  check('the billing run creates exactly one invoice', run.status === 201 || run.status === 200, run);
  check('  ...invoicesCreated = 1', run.json.invoicesCreated === 1, run.json);
  const run2 = await api('POST', '/platform-admin/commission/run', { token: admin });
  check('running billing again creates nothing new (never double-bills)', run2.json.invoicesCreated === 0, run2.json);
  const comm = await api('GET', '/online-store/me/commission', { token: owner });
  const invoice = comm.json.invoices?.[0];
  check('the invoice covers 2 orders, KES 750 sales, KES 22.50 commission, KES 23 to pay', invoice?.orderCount === 2 && invoice.salesTotal === 750 && invoice.commissionTotal === 22.5 && invoice.amountDue === 23 && invoice.status === 'ISSUED', invoice);
  check('the business can pay online, and is not paused', comm.json.canPayOnline === true && comm.json.paused === false);
  const orderBilled = await sql.query(`SELECT count(*)::int AS n FROM online_orders WHERE "commissionInvoiceId" IS NOT NULL`);
  check('both orders are tied to the invoice', orderBilled.rows[0].n === 2);

  section('14. Paying the invoice online (through the platform Tuma account)');
  const pay = await api('POST', `/online-store/me/commission/invoices/${invoice.id}/pay`, { token: owner, body: { phone: '0711000111' } });
  check('an M-Pesa prompt is sent for the invoice', pay.status === 200 && pay.json.paymentPending === true, pay);
  const pushes3 = (await mock('GET', '/_test/pushes')).json;
  const push3 = pushes3[pushes3.length - 1];
  check('the prompt is for KES 23 and names the invoice', push3.amount === 23 && /ZARODA commission/.test(push3.description || ''), push3);
  check('the callback address is the commission one', /\/public\/commission\//.test(push3.callback_url));
  await mock('POST', `/_test/forge/${push3.merchant_request_id}?mode=no-receipt`);
  const afterClaim3 = await api('GET', '/online-store/me/commission', { token: owner });
  check('a callback claiming success with no receipt does NOT settle the invoice', afterClaim3.json.invoices[0].status === 'ISSUED', afterClaim3.json.invoices[0]);
  await mock('POST', `/_test/pay/${push3.merchant_request_id}`);
  const afterPay3 = await api('GET', '/online-store/me/commission', { token: owner });
  const settled3 = afterPay3.json.invoices[0];
  check('the real payment settles it by itself: PAID by M-Pesa with a receipt', settled3.status === 'PAID' && settled3.paymentMethod === 'MPESA' && /^QTEST/.test(settled3.paymentReference || ''), settled3);
  const checkPaid = await api('POST', `/online-store/me/commission/invoices/${invoice.id}/check`, { token: owner });
  check('"check now" on an invoice that is already paid costs nothing', checkPaid.json.checkResult === 'not-needed', checkPaid.json);

  section('15. Unpaid commission hides the shop');
  // Turn the invoice back into an unpaid one that is 30 days overdue.
  await sql.query(
    `UPDATE commission_invoices SET status = 'ISSUED', "paidAt" = NULL, "paymentMethod" = NULL, "paymentReference" = NULL,
       "dueDate" = now() - interval '30 days', "tumaMerchantRequestId" = NULL WHERE id = $1`,
    [invoice.id],
  );
  const hidden = await api('GET', '/public/shops/demo-shop');
  check('the shop page now says "not found"', hidden.status === 404, hidden);
  const hiddenList = await api('GET', '/public/shops');
  check('the shop is gone from the marketplace list', !hiddenList.json.some((s) => s.slug === 'demo-shop'), hiddenList.json);
  const blockedOrder = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  check('new orders are refused', blockedOrder.status === 404, blockedOrder);
  const pausedView = await api('GET', '/online-store/me/commission', { token: owner });
  check('the owner is told the shop is paused', pausedView.json.paused === true);
  const manual = await api('POST', `/platform-admin/organizations/${orgId}/commission-invoices/${invoice.id}/payment`, { token: admin, body: { method: 'BANK', reference: 'BANK-TEST-1' } });
  check('platform admin records a bank payment', manual.status === 201 || manual.status === 200, manual);
  const back = await api('GET', '/public/shops/demo-shop');
  check('the shop reappears immediately', back.status === 200, back.status);
  const doublePay = await api('POST', `/platform-admin/organizations/${orgId}/commission-invoices/${invoice.id}/payment`, { token: admin, body: { method: 'CASH' } });
  check('paying an already-paid invoice is refused', doublePay.status === 409, doublePay);

  section('16. Signup and billing still work under the billing security rules');
  // Row-level security now also covers subscriptions and subscription payments.
  // These are the three flows that could have broken: a new business signing up
  // (creates a subscription), the platform admin's billing list, and recording
  // a subscription payment.
  const plan = await api('POST', '/platform-admin/plans', { token: admin, body: { tier: 'BASIC', name: 'Basic', priceKes: 1500, maxDevices: 2, maxBranches: 1 } });
  check('platform admin can create the BASIC plan', plan.status === 201 || plan.status === 200 || plan.status === 409, plan);
  const stamp = Date.now();
  const signup = await api('POST', '/auth/register', {
    body: { organizationName: `Signup Check ${stamp}`, industryType: 'RETAIL', ownerFullName: 'Signup Owner', ownerEmail: `signup${stamp}@example.test`, ownerPassword: 'a-long-test-password', branchName: 'Main', county: 'Nairobi' },
  });
  check('a brand-new business can sign up (and gets its trial subscription)', signup.status === 201 || signup.status === 200, signup);
  const orgs = await api('GET', '/platform-admin/organizations', { token: admin });
  const newOrg = Array.isArray(orgs.json) ? orgs.json.find((o) => o.name === `Signup Check ${stamp}`) : null;
  check('the platform admin billing list shows the new business with a TRIAL subscription', newOrg?.subscription?.status === 'TRIAL', newOrg);
  const billed = await api('POST', `/platform-admin/organizations/${newOrg?.id}/payments`, { token: admin, body: { amount: 1500, method: 'MPESA', reference: 'E2E-TEST' } });
  check('platform admin can record a subscription payment', billed.status === 201 || billed.status === 200, billed);
  const after = await api('GET', `/platform-admin/organizations/${newOrg?.id}`, { token: admin });
  check('the payment shows in that business\'s history and the subscription is no longer a trial', after.json.subscription?.payments?.length === 1 && after.json.subscription.isTrial === false, after.json.subscription);
  const ownTenant = await api('POST', '/auth/login', { body: { email: `signup${stamp}@example.test`, password: 'a-long-test-password' } });
  check('the new business owner can log in', Boolean(ownTenant.json.accessToken), ownTenant);
  const demoProducts = await api('GET', '/products', { token: ownTenant.json.accessToken });
  check('a business sees only its OWN data - none of the demo shop\'s products', Array.isArray(demoProducts.json) && demoProducts.json.length === 0, demoProducts.json);
  // The security rule itself, as the restricted app user the live API connects as:
  // the same table, three different views depending on whose request it is.
  const appDb = new Client({ connectionString: env.DATABASE_URL });
  await appDb.connect();
  const subsSeenBy = async (tenant) => {
    await appDb.query('BEGIN');
    if (tenant) await appDb.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
    const r = await appDb.query('SELECT count(*)::int AS n FROM subscriptions');
    await appDb.query('ROLLBACK');
    return r.rows[0].n;
  };
  check('the new business sees exactly its own subscription', (await subsSeenBy(newOrg.id)) === 1);
  check('the demo shop (a different business) sees NONE of it', (await subsSeenBy(orgId)) === 0);
  check('platform admin work (no business selected) still sees billing records', (await subsSeenBy(null)) >= 1);
  await appDb.end();

  section('17. Delivery riders');
  const RA = 'rider.a@example.test';
  const RB = 'rider.b@example.test';
  const codeA = await riderLogin(RA);
  const wrongA = await api('POST', '/rider-auth/verify', { body: { email: RA, code: codeA === '000000' ? '111111' : '000000' } });
  check('a wrong emailed code is refused for a rider', wrongA.status === 401, wrongA);
  const verifyA = await api('POST', '/rider-auth/verify', { body: { email: RA, code: codeA } });
  const riderA = verifyA.json.accessToken;
  check('a new rider signs in with the right code: pending, in the shared pool, profile not finished', Boolean(riderA) && verifyA.json.rider.status === 'PENDING' && verifyA.json.rider.kind === 'POOL' && verifyA.json.rider.profileComplete === false, verifyA);
  const reuseA = await api('POST', '/rider-auth/verify', { body: { email: RA, code: codeA } });
  check('a rider code cannot be used twice', reuseA.status === 401, reuseA);

  const riderMeA = await api('GET', '/rider/me', { token: riderA });
  check('the rider can read their own profile', riderMeA.status === 200 && riderMeA.json.email === RA, riderMeA);
  const noToken = await api('GET', '/rider/me', {});
  check('no token: refused', noToken.status === 401, noToken);
  const staffOnRider = await api('GET', '/rider/me', { token: owner });
  check('a shop staff token does NOT work as a rider', staffOnRider.status === 401, staffOnRider);
  const buyerOnRider = await api('GET', '/rider/me', { token: buyerA });
  check('a shopper token does NOT work as a rider', buyerOnRider.status === 401, buyerOnRider);
  const riderOnBuyer = await api('GET', '/buyer/me', { token: riderA });
  check('a rider token does NOT work as a shopper', riderOnBuyer.status === 401, riderOnBuyer);
  const riderOnStaff = await api('GET', '/riders', { token: riderA });
  check('a rider token does NOT work on the shop\'s staff pages', riderOnStaff.status === 401, riderOnStaff);
  const riderOnAdmin = await api('GET', '/platform-admin/riders', { token: riderA });
  check('a rider token does NOT work for the platform admin', riderOnAdmin.status === 401, riderOnAdmin);

  const badPhone = await api('PATCH', '/rider/me', { token: riderA, body: { phone: '123' } });
  check('a made-up phone number is refused', badPhone.status === 400, badPhone);
  const profileA = await api('PATCH', '/rider/me', { token: riderA, body: { fullName: 'Juma Otieno', phone: '0712 000 111', vehicleType: 'BODA', plateNumber: 'kmfa 123a', area: 'Milimani, Kisumu' } });
  check('the rider fills in their profile (phone normalized, plate in capitals) - still waiting for approval', profileA.json.profileComplete === true && profileA.json.phone === '254712000111' && profileA.json.plateNumber === 'KMFA 123A' && profileA.json.status === 'PENDING', profileA);

  const adminNoAuth = await api('GET', '/platform-admin/riders', {});
  const adminWithShop = await api('GET', '/platform-admin/riders', { token: owner });
  check('only a platform admin can see the approval queue', adminNoAuth.status === 401 && adminWithShop.status === 401, { adminNoAuth: adminNoAuth.status, adminWithShop: adminWithShop.status });
  const riderQueue = await api('GET', '/platform-admin/riders?status=PENDING', { token: admin });
  check('the platform admin sees the waiting rider', Array.isArray(riderQueue.json) && riderQueue.json.some((r) => r.email === RA), riderQueue);
  const approveA = await api('POST', `/platform-admin/riders/${verifyA.json.rider.id}/status`, { token: admin, body: { status: 'APPROVED' } });
  check('the platform admin approves the rider', (approveA.status === 200 || approveA.status === 201) && approveA.json.status === 'APPROVED', approveA);
  const riderMeA2 = await api('GET', '/rider/me', { token: riderA });
  check('the rider now sees they are approved', riderMeA2.json.status === 'APPROVED', riderMeA2.json);

  await sql.query("INSERT INTO riders (id, email, \"updatedAt\") VALUES (gen_random_uuid()::text, 'incomplete.rider@example.test', now())");
  const incompleteId = (await sql.query("SELECT id FROM riders WHERE email = 'incomplete.rider@example.test'")).rows[0].id;
  const approveIncomplete = await api('POST', `/platform-admin/riders/${incompleteId}/status`, { token: admin, body: { status: 'APPROVED' } });
  check('a rider who has not filled in their profile cannot be approved', approveIncomplete.status === 400, approveIncomplete);

  const newRiderBody = { email: RB, fullName: 'Achieng Ouma', phone: '0733 222 111', vehicleType: 'TUK_TUK', plateNumber: 'kcb 456z', area: 'Town' };
  const addB = await api('POST', '/riders', { token: owner, body: newRiderBody });
  check('the shop adds its own rider: approved at once, marked as the shop\'s own', addB.status === 201 && addB.json.status === 'APPROVED' && addB.json.kind === 'SHOP' && addB.json.plateNumber === 'KCB 456Z', addB);
  const dupEmail = await api('POST', '/riders', { token: owner, body: newRiderBody });
  check('adding the same rider again is refused plainly', dupEmail.status === 409, dupEmail);
  const takenByPool = await api('POST', '/riders', { token: owner, body: { ...newRiderBody, email: RA, phone: '0744 555 666' } });
  check('an email already in the shared pool cannot be taken by a shop', takenByPool.status === 409, takenByPool);
  const takenPhone = await api('POST', '/riders', { token: owner, body: { ...newRiderBody, email: 'other.rider@example.test', phone: '0712000111' } });
  check('a phone number already used by another rider is refused', takenPhone.status === 409, takenPhone);
  const shopList = await api('GET', '/riders', { token: owner });
  check('the shop sees ONLY its own riders (not the shared pool\'s)', Array.isArray(shopList.json) && shopList.json.length === 1 && shopList.json[0].email === RB, shopList.json);
  const poke = await api('POST', `/riders/${verifyA.json.rider.id}/status`, { token: owner, body: { status: 'SUSPENDED' } });
  check('a shop cannot suspend a pool rider (not found for it)', poke.status === 404, poke);
  const pokeEdit = await api('PATCH', `/riders/${verifyA.json.rider.id}`, { token: owner, body: { area: 'hacked' } });
  check('a shop cannot edit a pool rider either', pokeEdit.status === 404, pokeEdit);
  const otherShopList = await api('GET', '/riders', { token: ownTenant.json.accessToken });
  const otherShopAdd = await api('POST', '/riders', { token: ownTenant.json.accessToken, body: { ...newRiderBody, email: 'third@example.test', phone: '0755 000 999' } });
  check('another business sees none of this shop\'s riders', Array.isArray(otherShopList.json) && otherShopList.json.length === 0, otherShopList.json);
  check('and a business without the Online Shop add-on cannot add riders', otherShopAdd.status === 403, otherShopAdd);

  const codeB = await riderLogin(RB);
  const verifyB = await api('POST', '/rider-auth/verify', { body: { email: RB, code: codeB } });
  check('the shop\'s own rider signs in with their email (already approved, no second account)', verifyB.status === 200 && verifyB.json.rider.status === 'APPROVED' && verifyB.json.rider.kind === 'SHOP' && verifyB.json.rider.id === addB.json.id, verifyB);
  const rowsB = await sql.query('SELECT count(*)::int AS n FROM riders WHERE email = $1', [RB]);
  check('still exactly one account for that email', rowsB.rows[0].n === 1, rowsB.rows);
  section('18. Delivery: asking for a rider, quotes, the code at the door');
  const riderBToken = verifyB.json.accessToken;
  const riderAId = verifyA.json.rider.id;
  const riderBId = addB.json.id;
  const dOn = await api('PATCH', '/online-store/me', { token: owner, body: { deliveryEnabled: true } });
  check('the shop turns delivery on', dOn.status === 200 && dOn.json.deliveryEnabled === true, dOn);

  let dSeq = 0;
  const placeDelivery = async (address) => {
    for (let i = 0; i < 4; i++) {
      const r = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'DELIVERY', deliveryAddress: address, paymentPhone: '0722000333' } });
      if (r.status !== 429) return r;
      await sleep(31000); // the checkout rate limit - wait it out
    }
    return null;
  };
  const payAndAccept = async (order) => {
    dSeq++;
    await api('POST', `/online-orders/${order.id}/confirm-payment`, { token: owner, body: { receipt: `DLV${Date.now()}${dSeq}` } });
    return api('POST', `/online-orders/${order.id}/accept`, { token: owner });
  };

  const D = (await placeDelivery('Milimani, Kisumu, house 4 behind the blue gate')).json;
  check('a delivery order is placed', D?.fulfilmentType === 'DELIVERY' && D.status === 'PENDING_PAYMENT', D);
  const tooEarly = await api('POST', `/online-orders/${D.id}/delivery`, { token: owner, body: { audience: 'EVERYONE' } });
  check('a rider cannot be requested before the order is paid and accepted', tooEarly.status === 400, tooEarly);
  const dAccepted = await payAndAccept(D);
  check('the delivery order is paid and accepted', dAccepted.json.status === 'ACCEPTED', dAccepted);
  const pickupOrder = await api('POST', `/online-orders/${o1.id}/delivery`, { token: owner, body: { audience: 'EVERYONE' } });
  check('a pickup order needs no rider', pickupOrder.status === 400, pickupOrder);
  const noRider = await api('POST', `/online-orders/${D.id}/delivery`, { token: owner, body: { audience: 'ONE_RIDER' } });
  check('choosing "one rider" without saying who is refused', noRider.status === 400, noRider);

  const markOwn = logMark();
  const ownReq = await api('POST', `/online-orders/${D.id}/delivery`, { token: owner, body: { audience: 'SHOP_RIDERS' } });
  check('the shop asks only its own riders: the request is open', ownReq.status === 201 && ownReq.json.status === 'OPEN' && ownReq.json.audience === 'SHOP_RIDERS', ownReq);
  const mailedOwn = await mailedSince(markOwn);
  check('only the shop\'s own rider is emailed about the job - not the pool rider', mailedOwn.includes(RB) && !mailedOwn.includes(RA), mailedOwn);
  const dupReq = await api('POST', `/online-orders/${D.id}/delivery`, { token: owner, body: { audience: 'EVERYONE' } });
  check('a second request for the same order is refused while one is open', dupReq.status === 409, dupReq);
  const openA1 = await api('GET', '/rider/jobs/open', { token: riderA });
  check('a pool rider does NOT see a job meant for the shop\'s own riders', Array.isArray(openA1.json) && openA1.json.length === 0, openA1.json);
  const quoteA0 = await api('POST', `/rider/jobs/${ownReq.json.id}/quote`, { token: riderA, body: { fee: 300 } });
  check('...and cannot quote on it', quoteA0.status === 404, quoteA0);
  const openB1 = await api('GET', '/rider/jobs/open', { token: riderBToken });
  check('the shop\'s own rider sees it: the area, but NOT the buyer\'s phone or full address',
    Array.isArray(openB1.json) && openB1.json.length === 1 && openB1.json[0].dropoffSummary === 'Milimani, Kisumu' && !/blue gate|0722000333|254722000333/.test(JSON.stringify(openB1.json)), openB1.json);
  const cancelReq = await api('POST', `/online-orders/${D.id}/delivery/cancel`, { token: owner, body: { reason: 'wider search' } });
  check('the shop cancels that request', cancelReq.status === 200 && cancelReq.json.status === 'CANCELLED', cancelReq);

  const markAll = logMark();
  const allReq = await api('POST', `/online-orders/${D.id}/delivery`, { token: owner, body: { audience: 'EVERYONE' } });
  const JOB = allReq.json.id;
  check('the shop opens it to everyone', allReq.status === 201 && allReq.json.status === 'OPEN' && allReq.json.audience === 'EVERYONE', allReq);
  const mailedAll = await mailedSince(markAll);
  check('opening it to everyone emails the shop\'s rider AND the pool rider', mailedAll.includes(RB) && mailedAll.includes(RA), mailedAll);
  const openA2 = await api('GET', '/rider/jobs/open', { token: riderA });
  check('now the pool rider sees it', Array.isArray(openA2.json) && openA2.json.length === 1 && openA2.json[0].id === JOB, openA2.json);
  const lowFee = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderA, body: { fee: 5 } });
  const highFee = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderA, body: { fee: 20000 } });
  check('an absurdly low or high delivery price is refused', lowFee.status === 400 && highFee.status === 400, { low: lowFee.status, high: highFee.status });
  const markQuote1 = logMark();
  const qA = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderA, body: { fee: 250, etaMinutes: 20, note: 'I am near the shop' } });
  check('the pool rider quotes KES 250', qA.status === 200 && qA.json.myQuote.fee === 250, qA);
  const mailedQuote1 = await mailedSince(markQuote1);
  check('the shopper is emailed when the FIRST price arrives', mailedQuote1.includes(A_EMAIL), mailedQuote1);
  const markQuote2 = logMark();
  const qB = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderBToken, body: { fee: 180 } });
  const qB2 = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderBToken, body: { fee: 150, etaMinutes: 15 } });
  check('the shop\'s rider quotes KES 180, then lowers it to KES 150', qB.status === 200 && qB2.status === 200 && qB2.json.myQuote.fee === 150, { qB: qB.status, qB2: qB2.json });
  const mailedQuote2 = await mailedSince(markQuote2);
  check('a second rider\'s price, or a price change, does NOT email the shopper again', !mailedQuote2.includes(A_EMAIL), mailedQuote2);
  const openA3 = await api('GET', '/rider/jobs/open', { token: riderA });
  check('a rider only ever sees their OWN quote, never a competitor\'s', openA3.json[0].myQuote.fee === 250 && !JSON.stringify(openA3.json).includes('150'), openA3.json);
  const shopView1 = await api('GET', `/online-orders/${D.id}/delivery`, { token: owner });
  check('the shop sees both quotes, cheapest first', shopView1.json.quotes.length === 2 && shopView1.json.quotes[0].fee === 150 && shopView1.json.quotes[1].fee === 250, shopView1.json);
  const buyerView1 = await api('GET', `/buyer/orders/${D.id}/delivery`, { token: buyerA });
  check('the buyer sees both quotes, cheapest first, and no code yet', buyerView1.json.quotes.length === 2 && buyerView1.json.quotes[0].fee === 150 && buyerView1.json.deliveryCode === null && buyerView1.json.rider === null, buyerView1.json);
  const otherBuyerView = await api('GET', `/buyer/orders/${D.id}/delivery`, { token: buyerB });
  const otherBuyerAccept = await api('POST', `/buyer/orders/${D.id}/delivery/quotes/${buyerView1.json.quotes[0].id}/accept`, { token: buyerB });
  check('another shopper can neither see nor accept these quotes', otherBuyerView.status === 404 && otherBuyerAccept.status === 404, { view: otherBuyerView.status, accept: otherBuyerAccept.status });

  const markAccept = logMark();
  const accepted = await api('POST', `/buyer/orders/${D.id}/delivery/quotes/${buyerView1.json.quotes[0].id}/accept`, { token: buyerA });
  const mailedAccept = await mailedSince(markAccept);
  check('the rider the shopper chose is emailed - and the one who lost is not', mailedAccept.includes(RB) && !mailedAccept.includes(RA), mailedAccept);
  const dCode = accepted.json.deliveryCode;
  check('the buyer accepts the KES 150 quote: assigned, with the rider\'s phone and a 4-digit code',
    accepted.status === 200 && accepted.json.status === 'ASSIGNED' && accepted.json.agreedFee === 150 && /^\d{4}$/.test(dCode || '') && accepted.json.rider.phone === '254733222111', accepted.json);
  const acceptAgain = await api('POST', `/buyer/orders/${D.id}/delivery/quotes/${buyerView1.json.quotes[1].id}/accept`, { token: buyerA });
  check('a second quote cannot be accepted afterwards', acceptAgain.status === 400 || acceptAgain.status === 404, acceptAgain);
  const shopView2 = await api('GET', `/online-orders/${D.id}/delivery`, { token: owner });
  check('the shop sees the chosen rider and their phone, but never the delivery code', shopView2.json.status === 'ASSIGNED' && shopView2.json.rider.phone === '254733222111' && !('deliveryCode' in shopView2.json), shopView2.json);
  const openA4 = await api('GET', '/rider/jobs/open', { token: riderA });
  const quoteA1 = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderA, body: { fee: 100 } });
  const mineA = await api('GET', '/rider/jobs/mine', { token: riderA });
  check('the rider who lost no longer sees the job and cannot quote', openA4.json.length === 0 && quoteA1.status === 404 && mineA.json.length === 0, { open: openA4.json, quote: quoteA1.status, mine: mineA.json });
  const mineB = await api('GET', '/rider/jobs/mine', { token: riderBToken });
  check('the chosen rider now gets the buyer\'s phone and full address, and the agreed price (but not the code)',
    mineB.json.length === 1 && mineB.json[0].buyerPhone === '254722000333' && /blue gate/.test(mineB.json[0].deliveryAddress) && mineB.json[0].agreedFee === 150 && !('deliveryCode' in mineB.json[0]), mineB.json);

  const pickA = await api('POST', `/rider/jobs/${JOB}/pickup`, { token: riderA });
  check('a rider who was not chosen cannot pick the goods up', pickA.status === 400, pickA);
  const deliverEarly = await api('POST', `/rider/jobs/${JOB}/deliver`, { token: riderBToken, body: { code: dCode } });
  check('delivering before picking up is refused', deliverEarly.status === 400, deliverEarly);
  const markPick = logMark();
  const pickB = await api('POST', `/rider/jobs/${JOB}/pickup`, { token: riderBToken });
  const mailedPick = await mailedSince(markPick);
  check('picking the goods up emails the shopper that the order is on its way', mailedPick.includes(A_EMAIL), mailedPick);
  check('the chosen rider picks the goods up', pickB.status === 200 && pickB.json.status === 'PICKED_UP', pickB);
  const wrongDelivery = await api('POST', `/rider/jobs/${JOB}/deliver`, { token: riderBToken, body: { code: dCode === '0000' ? '1111' : '0000' } });
  const attempts = await sql.query('SELECT "codeAttempts" AS n FROM delivery_jobs WHERE id = $1', [JOB]);
  check('a wrong code is refused, counted (even though the request failed), and the order stays open', wrongDelivery.status === 400 && /tries left/.test(wrongDelivery.json.message || '') && attempts.rows[0].n === 1, { wrongDelivery, attempts: attempts.rows });
  const deliverA = await api('POST', `/rider/jobs/${JOB}/deliver`, { token: riderA, body: { code: dCode } });
  check('another rider cannot deliver it, even knowing the code', deliverA.status === 404, deliverA);
  const delivered = await api('POST', `/rider/jobs/${JOB}/deliver`, { token: riderBToken, body: { code: dCode, cashCollected: 150 } });
  check('the right code completes the delivery', delivered.status === 200 && delivered.json.status === 'DELIVERED' && delivered.json.cashCollected === 150, delivered);
  const dOrderRow = await sql.query('SELECT status, "commissionAmount"::float AS c FROM online_orders WHERE id = $1', [D.id]);
  check('the order completes with it, and the 3% commission (KES 7.50, products only) is recorded', dOrderRow.rows[0].status === 'COMPLETED' && dOrderRow.rows[0].c === 7.5, dOrderRow.rows);
  const deliverTwice = await api('POST', `/rider/jobs/${JOB}/deliver`, { token: riderBToken, body: { code: dCode } });
  check('a delivery cannot be confirmed twice', deliverTwice.status === 400, deliverTwice);
  const buyerView2 = await api('GET', `/buyer/orders/${D.id}/delivery`, { token: buyerA });
  const shopView3 = await api('GET', `/online-orders/${D.id}/delivery`, { token: owner });
  check('buyer and shop both see it delivered; the code is gone; the shop sees the cash the rider reported', buyerView2.json.status === 'DELIVERED' && buyerView2.json.deliveryCode === null && shopView3.json.status === 'DELIVERED' && shopView3.json.cashCollected === 150, { buyer: buyerView2.json, shop: shopView3.json });

  // The database's own rules, as the restricted user the live API connects as.
  const riderDb = new Client({ connectionString: env.DATABASE_URL });
  await riderDb.connect();
  const seenBy = async (riderId, table) => {
    await riderDb.query('BEGIN');
    if (riderId) await riderDb.query("SELECT set_config('app.current_rider', $1, true)", [riderId]);
    const r = await riderDb.query(`SELECT count(*)::int AS n FROM ${table}`);
    await riderDb.query('ROLLBACK');
    return r.rows[0].n;
  };
  check('the database shows a rider only their own quotes (1 each)', (await seenBy(riderAId, 'delivery_quotes')) === 1 && (await seenBy(riderBId, 'delivery_quotes')) === 1);
  check('the database shows the delivery to its rider only', (await seenBy(riderBId, 'delivery_jobs')) === 1 && (await seenBy(riderAId, 'delivery_jobs')) === 0);
  check('the buyer\'s phone and address are visible to the chosen rider only - not another rider, not nobody',
    (await seenBy(riderBId, 'delivery_job_contacts')) === 1 && (await seenBy(riderAId, 'delivery_job_contacts')) === 0 && (await seenBy(null, 'delivery_job_contacts')) === 0);
  await riderDb.query('BEGIN');
  await riderDb.query("SELECT set_config('app.current_rider', $1, true)", [riderAId]);
  const hijack = await riderDb.query("UPDATE delivery_jobs SET status = 'CANCELLED' WHERE id = $1", [JOB]);
  await riderDb.query('ROLLBACK');
  check('a rider cannot change a job that is not theirs, even straight in the database', hijack.rowCount === 0);
  await riderDb.end();

  // A second order whose quote window runs out, then is asked again, and is settled by hand.
  const D2 = (await placeDelivery('Nyalenda, Kisumu')).json;
  await payAndAccept(D2);
  const j2 = (await api('POST', `/online-orders/${D2.id}/delivery`, { token: owner, body: { audience: 'EVERYONE' } })).json;
  await api('POST', `/rider/jobs/${j2.id}/quote`, { token: riderBToken, body: { fee: 200 } });
  await sql.query("UPDATE delivery_jobs SET \"quoteDeadline\" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = $1", [j2.id]);
  const openExpired = await api('GET', '/rider/jobs/open', { token: riderBToken });
  const quoteExpired = await api('POST', `/rider/jobs/${j2.id}/quote`, { token: riderBToken, body: { fee: 150 } });
  check('when the time is up, riders no longer see or quote on the job', openExpired.json.length === 0 && quoteExpired.status === 404, { open: openExpired.json, quote: quoteExpired.status });
  const expiredBuyer = await api('GET', `/buyer/orders/${D2.id}/delivery`, { token: buyerA });
  const acceptExpired = await api('POST', `/buyer/orders/${D2.id}/delivery/quotes/${(await sql.query('SELECT id FROM delivery_quotes WHERE "jobId" = $1', [j2.id])).rows[0].id}/accept`, { token: buyerA });
  check('the buyer sees it expired and can no longer accept a late quote', expiredBuyer.json.status === 'EXPIRED' && acceptExpired.status === 400, { view: expiredBuyer.json.status, accept: acceptExpired.status });
  const j2b = await api('POST', `/online-orders/${D2.id}/delivery`, { token: owner, body: { audience: 'ONE_RIDER', riderId: riderBId } });
  check('the shop can ask again - this time just one rider', j2b.status === 201 && j2b.json.status === 'OPEN' && j2b.json.audience === 'ONE_RIDER', j2b);
  const openA5 = await api('GET', '/rider/jobs/open', { token: riderA });
  check('a job offered to one rider is invisible to the others', openA5.json.length === 0, openA5.json);
  await api('POST', `/rider/jobs/${j2b.json.id}/quote`, { token: riderBToken, body: { fee: 120 } });
  const b2 = await api('GET', `/buyer/orders/${D2.id}/delivery`, { token: buyerA });
  await api('POST', `/buyer/orders/${D2.id}/delivery/quotes/${b2.json.quotes[0].id}/accept`, { token: buyerA });
  await api('POST', `/rider/jobs/${j2b.json.id}/pickup`, { token: riderBToken });
  const manualDone = await api('POST', `/online-orders/${D2.id}/complete`, { token: owner });
  const j2row = await sql.query('SELECT status FROM delivery_jobs WHERE id = $1', [j2b.json.id]);
  check('the shop completing the order by hand also closes the delivery as delivered', manualDone.json.status === 'COMPLETED' && j2row.rows[0].status === 'DELIVERED', { order: manualDone.json.status, job: j2row.rows });

  // A third order cancelled by the shop while riders are still quoting.
  const D3 = (await placeDelivery('Kibuye, Kisumu')).json;
  await payAndAccept(D3);
  const j3 = (await api('POST', `/online-orders/${D3.id}/delivery`, { token: owner, body: { audience: 'EVERYONE' } })).json;
  await api('POST', `/rider/jobs/${j3.id}/quote`, { token: riderA, body: { fee: 300 } });
  const cancelOrder3 = await api('POST', `/online-orders/${D3.id}/cancel`, { token: owner, body: { reason: 'customer called to cancel' } });
  const j3row = await sql.query('SELECT j.status AS job, q.status AS quote FROM delivery_jobs j JOIN delivery_quotes q ON q."jobId" = j.id WHERE j.id = $1', [j3.id]);
  check('cancelling the order cancels the delivery request and closes the quotes', cancelOrder3.json.status === 'CANCELLED' && j3row.rows[0].job === 'CANCELLED' && j3row.rows[0].quote === 'REJECTED', { order: cancelOrder3.json.status, rows: j3row.rows });

  section('19. Suspended riders and tidy-up');
  const suspendB = await api('POST', `/riders/${addB.json.id}/status`, { token: owner, body: { status: 'SUSPENDED' } });
  const riderMeB = await api('GET', '/rider/me', { token: verifyB.json.accessToken });
  check('the shop suspends its rider and the rider sees it', suspendB.json.status === 'SUSPENDED' && riderMeB.json.status === 'SUSPENDED', { s: suspendB.json.status, me: riderMeB.json.status });
  const suspendA = await api('POST', `/platform-admin/riders/${verifyA.json.rider.id}/status`, { token: admin, body: { status: 'SUSPENDED' } });
  check('the platform admin can suspend a pool rider', suspendA.json.status === 'SUSPENDED', suspendA);
  const otpRows = await sql.query("SELECT count(*)::int AS n FROM rider_otps WHERE \"codeHash\" = $1 OR \"codeHash\" = $2", [codeA, codeB]);
  check('login codes are stored only as hashes, never as the code itself', otpRows.rows[0].n === 0, otpRows.rows);

  const openSuspended = await api('GET', '/rider/jobs/open', { token: riderA });
  const quoteSuspended = await api('POST', `/rider/jobs/${JOB}/quote`, { token: riderA, body: { fee: 100 } });
  check('a suspended rider can no longer see or take jobs', openSuspended.status === 403 && quoteSuspended.status === 403, { open: openSuspended.status, quote: quoteSuspended.status });

  console.log(`\n${failures.length === 0 ? 'ALL GOOD' : 'PROBLEMS FOUND'}: ${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) console.log('Failed:\n - ' + failures.join('\n - '));
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('\nTEST STOPPED BY AN ERROR:', e.message);
  await sql.end().catch(() => undefined);
  process.exit(2);
});
