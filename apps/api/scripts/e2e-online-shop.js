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

const env = {};
for (const line of fs.readFileSync(path.join(API_DIR, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const dbHost = new URL(env.DIRECT_URL);
if (dbHost.hostname !== 'localhost' || dbHost.port !== '5433') throw new Error('REFUSING: .env.local does not point at the local test database');
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

async function buyerLogin(phone) {
  const request = await api('POST', '/buyer-auth/request-code', { body: { phone } });
  check(`buyer ${phone}: code requested`, request.status === 200, request);
  await sleep(500);
  const log = fs.readFileSync(API_LOG, 'utf8');
  const codes = [...log.matchAll(/Dev login code for (\d+): (\d{6})/g)].filter((m) => m[1] === request.json.phone);
  const code = codes.length ? codes[codes.length - 1][2] : null;
  check(`buyer ${phone}: code found in the API log (dev mode, no SMS)`, Boolean(code));
  return { code, normalized: request.json.phone };
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

  section('6. Shopper A buys');
  const a = await buyerLogin('0722000333');
  const wrongCode = await api('POST', '/buyer-auth/verify', { body: { phone: '0722000333', code: a.code === '000000' ? '111111' : '000000' } });
  check('a wrong SMS code is refused', wrongCode.status === 401, wrongCode);
  const aVerify = await api('POST', '/buyer-auth/verify', { body: { phone: '0722000333', code: a.code } });
  const buyerA = aVerify.json.accessToken;
  check('shopper A signs in with the right code', Boolean(buyerA), aVerify);

  const tooMany = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 25 }], fulfilmentType: 'PICKUP' } });
  check('ordering more than the stock is refused', tooMany.status === 409, tooMany);
  const delivery = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'DELIVERY', deliveryAddress: 'Somewhere nice 12' } });
  check('delivery is refused when the shop does not offer it', delivery.status === 400, delivery);
  const noAuth = await api('POST', '/buyer/orders', { body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  check('ordering without signing in is refused', noAuth.status === 401, noAuth);
  const staffToken = await api('GET', '/buyer/me', { token: owner });
  check('a shop owner\'s staff token does not work on buyer routes', staffToken.status === 401, staffToken);

  const order1 = await api('POST', '/buyer/orders', { token: buyerA, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 2 }], fulfilmentType: 'PICKUP' } });
  const o1 = order1.json;
  check('order for 2 units placed: KES 500, waiting for payment', order1.status === 201 && o1.status === 'PENDING_PAYMENT' && o1.amountDue === 500, order1);
  const pushes1 = (await mock('GET', '/_test/pushes')).json;
  const push1 = pushes1[pushes1.length - 1];
  check('an M-Pesa prompt for KES 500 was sent to the shopper\'s phone', push1?.amount === 500 && push1.phone === '254722000333', push1);
  check('the payment callback address is the secret, signed one', /\/public\/online-orders\/[0-9a-f-]+\/[0-9a-f-]+\/tuma-callback\/[A-Za-z0-9_-]{30,}$/.test(push1?.callback_url || ''), push1?.callback_url);

  const held = await api('GET', '/public/shops/demo-shop');
  check('the 2 units are held, so only 18 show as available', held.json.products[0].variants[0].available === 18);

  section('7. An attacker tries to fake a payment');
  const forgedBadToken = await call('POST', push1.callback_url.replace(/[^/]+$/, 'not-the-real-token'), { body: { status: 'completed', amount: 500, mpesa_receipt_number: 'FAKE1' } });
  check('a callback with a made-up address token is rejected', forgedBadToken.status === 404, forgedBadToken);
  const forged = await mock('POST', `/_test/forge/${push1.merchant_request_id}`);
  check('(the pretend Tuma sent a "completed" callback without any payment)', forged.status === 200);
  const afterForge = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('the API asked Tuma, was told "not paid", and left the order UNPAID', afterForge.json.status === 'PENDING_PAYMENT', afterForge.json);

  section('8. The real payment arrives');
  const paid = await mock('POST', `/_test/pay/${push1.merchant_request_id}`);
  check('shopper pays; Tuma calls back and the API accepts it', paid.status === 200 && paid.json.callbackAnsweredWith === 200, paid.json);
  const afterPay = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('the order is now PAID with the M-Pesa receipt', afterPay.json.status === 'PAID' && /^QTEST/.test(afterPay.json.mpesaReceiptNumber || ''), afterPay.json);
  await mock('POST', `/_test/pay/${push1.merchant_request_id}`);
  const afterReplay = await api('GET', `/buyer/orders/${o1.id}`, { token: buyerA });
  check('the same payment replayed changes nothing', afterReplay.json.status === 'PAID' && afterReplay.json.mpesaReceiptNumber === afterPay.json.mpesaReceiptNumber);
  const receipts = await sql.query(`SELECT count(*)::int AS n FROM online_orders WHERE "mpesaReceiptNumber" = $1`, [afterPay.json.mpesaReceiptNumber]);
  check('one M-Pesa receipt belongs to exactly one order', receipts.rows[0].n === 1);

  section('9. Privacy between shoppers');
  const b = await buyerLogin('0733000444');
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
  const markedReady = await api('POST', `/online-orders/${o1.id}/ready`, { token: owner });
  check('marked ready for pickup', markedReady.json.status === 'READY');
  const complete = await api('POST', `/online-orders/${o1.id}/complete`, { token: owner });
  check('collected: order completed, 3% commission recorded = KES 15', complete.json.status === 'COMPLETED' && complete.json.commissionAmount === 15, complete.json);
  const again = await api('POST', `/online-orders/${o1.id}/accept`, { token: owner });
  check('an order cannot be accepted twice', again.status === 400, again);

  section('11. Payment whose callback never arrives (fallback re-check)');
  const order2 = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 1 }], fulfilmentType: 'PICKUP' } });
  const o2 = order2.json;
  check('shopper B places a KES 250 order', order2.status === 201 && o2.amountDue === 250, order2);
  const pushes2 = (await mock('GET', '/_test/pushes')).json;
  const push2 = pushes2[pushes2.length - 1];
  await mock('POST', `/_test/pay-silent/${push2.merchant_request_id}`);
  const recheck = await api('GET', `/buyer/orders/${o2.id}`, { token: buyerB });
  check('Tuma never called back, yet opening the order finds it paid', recheck.json.status === 'PAID', recheck.json);
  await api('POST', `/online-orders/${o2.id}/accept`, { token: owner });
  const complete2 = await api('POST', `/online-orders/${o2.id}/complete`, { token: owner });
  check('second order completed (commission KES 7.50)', complete2.json.status === 'COMPLETED' && complete2.json.commissionAmount === 7.5, complete2.json);

  section('12. Cancelling');
  const order3 = await api('POST', '/buyer/orders', { token: buyerB, body: { shopSlug: 'demo-shop', lines: [{ variantId, quantity: 3 }], fulfilmentType: 'PICKUP' } });
  const heldBefore = (await api('GET', '/public/shops/demo-shop')).json.products[0].variants[0].available;
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
  await mock('POST', `/_test/forge/${push3.merchant_request_id}`);
  const afterForge3 = await api('POST', `/online-store/me/commission/invoices/${invoice.id}/check`, { token: owner });
  check('a forged "paid" callback does NOT settle the invoice', afterForge3.json.status === 'ISSUED', afterForge3.json);
  await mock('POST', `/_test/pay/${push3.merchant_request_id}`);
  const afterPay3 = await api('POST', `/online-store/me/commission/invoices/${invoice.id}/check`, { token: owner });
  check('the real payment settles it: PAID by M-Pesa with a receipt', afterPay3.json.status === 'PAID' && afterPay3.json.paymentMethod === 'MPESA' && /^QTEST/.test(afterPay3.json.paymentReference || ''), afterPay3.json);

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

  console.log(`\n${failures.length === 0 ? 'ALL GOOD' : 'PROBLEMS FOUND'}: ${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) console.log('Failed:\n - ' + failures.join('\n - '));
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('\nTEST STOPPED BY AN ERROR:', e.message);
  await sql.end().catch(() => undefined);
  process.exit(2);
});
