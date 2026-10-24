// End-to-end test of the school supplier module against a LOCAL test setup: schools, price list, the school portal sign-in,
// ordering, confirming, delivering (delivery note + invoice + stock), part payments with receipts, bounced cheques, statements
// and the walls between one school and another. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and `ENV_FILE=.env.local node scripts/apply-rls.js`
// applied, the API started with the test settings (npm run start:test), plus the demo seed.
//   node scripts/e2e-school-supplier.js
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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 500) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36).toUpperCase();
const nairobi = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const phoneA = '0711' + String(Math.floor(100000 + Math.random() * 899999));
const phoneB = '0722' + String(Math.floor(100000 + Math.random() * 899999));

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('owner can sign in', Boolean(owner));
  const me = (await api('GET', '/organizations/me', { token: owner })).json;
  const orgId = me.id;
  const branchId = (await api('GET', '/branches', { token: owner })).json[0].id;

  section('1. Protection');
  for (const t of ['school_portals', 'supplier_schools', 'school_orders', 'school_order_lines', 'school_deliveries', 'school_delivery_lines', 'supplier_invoices', 'supplier_invoice_lines', 'supplier_payments', 'supplier_payment_allocations', 'document_counters']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }
  check('the supplier screens need a sign-in', (await api('GET', '/school-supplier/schools')).status === 401);
  check('the school portal needs a school sign-in', (await api('GET', '/school-portal/price-list')).status === 401);
  check('a staff token is not a school token', (await api('GET', '/school-portal/price-list', { token: owner })).status === 401);

  section('2. Business details, the portal address and the price list');
  const details = await api('PATCH', '/organizations/me', { token: owner, body: { address: 'Moi Avenue, Nairobi', phone: '0700123456', invoiceFooter: 'Bank: Test Bank 123' } });
  check('letterhead details are saved', details.status === 200 && details.json.address === 'Moi Avenue, Nairobi' && details.json.invoiceFooter === 'Bank: Test Bank 123', details);
  const slug = `e2e-${tag.toLowerCase()}`;
  check('a bad link name is refused', (await api('PUT', '/school-supplier/portal', { token: owner, body: { slug: 'a b', displayName: 'X Stationers' } })).status === 400);
  const portal = await api('PUT', '/school-supplier/portal', { token: owner, body: { slug, displayName: `Jaribu Stationers ${tag}` } });
  check('the portal address is saved', portal.status === 200 && portal.json.slug === slug && portal.json.enabled === true, portal);

  const book = (await api('POST', `/products/${(await api('POST', '/products', { token: owner, body: { name: `Exercise book ${tag}` } })).json.id}/variants`, { token: owner, body: { sku: `EXB-${tag}`, price: 50 } })).json;
  const pen = (await api('POST', `/products/${(await api('POST', '/products', { token: owner, body: { name: `Blue pen ${tag}` } })).json.id}/variants`, { token: owner, body: { sku: `PEN-${tag}`, price: 20 } })).json;
  const hidden = (await api('POST', `/products/${(await api('POST', '/products', { token: owner, body: { name: `Counter only ${tag}` } })).json.id}/variants`, { token: owner, body: { sku: `HID-${tag}`, price: 99 } })).json;
  check('three test products exist', Boolean(book.id && pen.id && hidden.id));
  const receive = (variantId, qty, cost) => api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId, type: 'ADJUSTMENT', quantityDelta: qty, unitCost: cost } });
  await receive(book.id, 100, 30);
  await receive(pen.id, 100, 10);
  const stockOf = async (id) => Number((await sql.query('SELECT coalesce(sum(quantity),0) AS q FROM inventory_items WHERE "variantId" = $1', [id])).rows[0].q);

  const saveList = await api('PUT', '/school-supplier/price-list', { token: owner, body: { entries: [{ variantId: book.id, onSchoolList: true, schoolPrice: 45 }, { variantId: pen.id, onSchoolList: true }] } });
  check('two items are put on the school price list', saveList.status === 200 && saveList.json.saved === 2, saveList);
  check('an unknown product on the list is refused', (await api('PUT', '/school-supplier/price-list', { token: owner, body: { entries: [{ variantId: '00000000-0000-4000-8000-000000000000', onSchoolList: true }] } })).status === 400);
  const full = await api('GET', '/school-supplier/price-list', { token: owner });
  const bookRow = full.json.find((r) => r.variantId === book.id);
  check('the back office sees every product with its school price', full.status === 200 && bookRow?.schoolPrice === 45 && bookRow?.onSchoolList === true && full.json.some((r) => r.variantId === hidden.id && !r.onSchoolList), bookRow);

  section('3. Adding schools');
  const noPhone = await api('POST', '/school-supplier/schools', { token: owner, body: { name: 'Bad School', phone: '12' } });
  check('a school with a bad phone number is refused', noPhone.status === 400, noPhone);
  const a = await api('POST', '/school-supplier/schools', { token: owner, body: { name: `Greenfield Academy ${tag}`, contactName: 'Mrs Akinyi', phone: phoneA, creditLimit: 10000, creditDays: 30 } });
  check('a school is added and the supplier is shown its PIN once', a.status === 201 && /^\d{4}$/.test(a.json.temporaryPin) && a.json.hasPin === true, a);
  check('the PIN is not stored in clear', (await sql.query('SELECT "pinHash" FROM supplier_schools WHERE id = $1', [a.json.id])).rows[0].pinHash.includes(':'));
  const b = await api('POST', '/school-supplier/schools', { token: owner, body: { name: `Hillside Primary ${tag}`, phone: phoneB, creditDays: 14 } });
  check('a second school is added (no credit limit)', b.status === 201 && b.json.creditLimit === null && b.json.creditDays === 14, b);
  check('two schools cannot share a sign-in number', (await api('POST', '/school-supplier/schools', { token: owner, body: { name: 'Clone', phone: phoneA } })).status === 409);
  const pinA = a.json.temporaryPin;
  const pinB = b.json.temporaryPin;

  section('4. School sign-in');
  const info = await api('GET', `/school-auth/portal/${slug}`);
  check('the sign-in page can find the business by its link', info.status === 200 && info.json.displayName === `Jaribu Stationers ${tag}`, info);
  const wrong = await api('POST', '/school-auth/login', { body: { slug, phone: phoneA, pin: pinA === '7391' ? '7392' : '7391' } });
  check('a wrong PIN is refused', wrong.status === 401, wrong);
  const unknownLink = await api('POST', '/school-auth/login', { body: { slug: 'no-such-shop', phone: phoneA, pin: pinA } });
  check('an unknown link gets the same answer as a wrong PIN', unknownLink.status === 401 && unknownLink.json.message === wrong.json.message, unknownLink);
  const loginA = await api('POST', '/school-auth/login', { body: { slug, phone: '+254 ' + phoneA.slice(1), pin: pinA } });
  check('the right PIN (phone typed another way) signs in', loginA.status === 200 && Boolean(loginA.json.accessToken) && loginA.json.school.id === a.json.id, loginA);
  const tokenA = loginA.json.accessToken;
  const loginB = await api('POST', '/school-auth/login', { body: { slug, phone: phoneB, pin: pinB } });
  check('the second school signs in', loginB.status === 200, loginB);
  const tokenB = loginB.json.accessToken;
  const meA = await api('GET', '/school-portal/me', { token: tokenA });
  check('a school sees itself and the supplier', meA.status === 200 && meA.json.school.id === a.json.id && meA.json.supplier.name === me.name, meA);

  section('5. The school orders');
  const list = await api('GET', '/school-portal/price-list', { token: tokenA });
  const lbook = list.json.find((r) => r.variantId === book.id);
  const lpen = list.json.find((r) => r.variantId === pen.id);
  check('the school sees only items on the list', list.status === 200 && list.json.length >= 2 && !list.json.some((r) => r.variantId === hidden.id), list.json.map?.((r) => r.title));
  check('the school price is used when set, else the normal price', lbook?.unitPrice === 45 && lpen?.unitPrice === 20, [lbook, lpen]);
  check('an item not on the list cannot be ordered', (await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: hidden.id, quantity: 1 }] } })).status === 400);
  check('an empty order is refused', (await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [] } })).status === 400);
  const o1 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lpoNumber: 'LPO-77', notes: 'Please deliver before 10am', lines: [{ variantId: book.id, quantity: 100 }, { variantId: pen.id, quantity: 50 }] } });
  check('an order is submitted with the school\'s own LPO number', o1.status === 201 && o1.json.status === 'SUBMITTED' && o1.json.lpoNumber === 'LPO-77' && /^SO-\d{4}-\d{4}$/.test(o1.json.orderNumber), o1);
  check('it adds up: 100 x 45 + 50 x 20 = 5500', o1.json.total === 5500 && o1.json.overCreditLimit === false, o1.json);
  check('stock is not touched by ordering', (await stockOf(book.id)) === 100);
  check('the other school cannot see this order', (await api('GET', `/school-portal/orders/${o1.json.id}`, { token: tokenB })).status === 404);
  check('the other school cannot cancel it either', (await api('POST', `/school-portal/orders/${o1.json.id}/cancel`, { token: tokenB, body: { reason: 'mine now' } })).status === 409);
  const o2 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: book.id, quantity: 200 }] } });
  check('an order that would pass the credit limit is accepted but flagged: 9000 on its own is within 10000, add 4600 owed later', o2.status === 201, o2);
  const o3 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: book.id, quantity: 1 }] } });
  const withdrawn = await api('POST', `/school-portal/orders/${o3.json.id}/cancel`, { token: tokenA, body: { reason: 'Ordered by mistake' } });
  check('the school can withdraw an order the supplier has not confirmed', withdrawn.status === 200 && withdrawn.json.status === 'CANCELLED' && withdrawn.json.cancelledBy === 'SCHOOL', withdrawn);
  const mine = await api('GET', '/school-portal/orders', { token: tokenA });
  check('the school lists its own orders', mine.status === 200 && mine.json.length === 3 && (await api('GET', '/school-portal/orders', { token: tokenB })).json.length === 0);
  const pending = await api('GET', '/school-supplier/orders/pending-count', { token: owner });
  check('the supplier is told how many orders wait (at least 2)', pending.status === 200 && pending.json.count >= 2, pending);

  section('6. The supplier confirms and delivers');
  const lines = o1.json.lines;
  const lBook = lines.find((l) => l.sku === `EXB-${tag}`);
  const lPen = lines.find((l) => l.sku === `PEN-${tag}`);
  check('a deliver before confirming is refused', (await api('POST', `/school-supplier/orders/${o1.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } })).status === 409);
  check('confirming more than was ordered is refused', (await api('POST', `/school-supplier/orders/${o1.json.id}/confirm`, { token: owner, body: { lines: [{ lineId: lBook.id, quantity: 101 }] } })).status === 400);
  const confirmed = await api('POST', `/school-supplier/orders/${o1.json.id}/confirm`, { token: owner, body: { lines: [{ lineId: lBook.id, quantity: 80 }], note: 'Only 80 books today' } });
  check('the order is confirmed with fewer books (80 x 45 + 50 x 20 = 4600)', confirmed.status === 200 && confirmed.json.status === 'CONFIRMED' && confirmed.json.total === 4600, confirmed);
  check('the school sees the change', (await api('GET', `/school-portal/orders/${o1.json.id}`, { token: tokenA })).json.confirmationNote === 'Only 80 books today');
  check('the school can no longer cancel it', (await api('POST', `/school-portal/orders/${o1.json.id}/cancel`, { token: tokenA, body: { reason: 'changed my mind' } })).status === 409);
  check('delivering more than confirmed is refused', (await api('POST', `/school-supplier/orders/${o1.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno', lines: [{ lineId: lBook.id, quantity: 81 }] } })).status === 400);
  check('and nothing moved', (await stockOf(book.id)) === 100);

  const stockBefore = { book: await stockOf(book.id), pen: await stockOf(pen.id) };
  const delivered = await api('POST', `/school-supplier/orders/${o1.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno', notes: 'Left at the bursar\'s office' } });
  check('the order is delivered', delivered.status === 200 && delivered.json.status === 'DELIVERED' && delivered.json.deliveries[0].receivedByName === 'Mr Otieno', delivered);
  check('it gets a delivery note number and an invoice number', /^DN-\d{4}-\d{4}$/.test(delivered.json.deliveries[0]?.deliveryNoteNumber) && /^INV-\d{4}-\d{4}$/.test(delivered.json.deliveries[0]?.invoice?.invoiceNumber), delivered.json);
  check('stock came down by what was delivered (80 books, 50 pens)', (await stockOf(book.id)) === stockBefore.book - 80 && (await stockOf(pen.id)) === stockBefore.pen - 50);
  const movement = await sql.query(`SELECT type, "quantityDelta" FROM inventory_transactions WHERE "referenceId" = $1 ORDER BY "quantityDelta"`, [delivered.json.deliveries[0].id]);
  check('each movement is recorded as a credit sale', movement.rows.length === 2 && movement.rows.every((r) => r.type === 'CREDIT_SALE'), movement.rows);
  check('delivering again is refused', (await api('POST', `/school-supplier/orders/${o1.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } })).status === 409);

  const invoiceId = delivered.json.deliveries[0].invoice.id;
  const inv = await api('GET', `/school-supplier/invoices/${invoiceId}`, { token: owner });
  check('the invoice shows exactly what was delivered: total 4600, nothing paid', inv.status === 200 && inv.json.total === 4600 && inv.json.balance === 4600 && inv.json.status === 'ISSUED' && inv.json.lines.length === 2, inv.json);
  check('it falls due after the school\'s 30 credit days', inv.json.issueDate === nairobi() && inv.json.dueDate === nairobi(30), [inv.json.issueDate, inv.json.dueDate]);
  check('it carries the business letterhead for printing', inv.json.business?.address === 'Moi Avenue, Nairobi' && inv.json.business?.invoiceFooter === 'Bank: Test Bank 123', inv.json.business);
  const costs = await sql.query('SELECT description, "unitCost" FROM supplier_invoice_lines WHERE "invoiceId" = $1 ORDER BY description', [invoiceId]);
  check('the cost of the goods is written on the invoice lines for the profit report', costs.rows.some((r) => Number(r.unitCost) === 30) && costs.rows.some((r) => Number(r.unitCost) === 10), costs.rows);
  check('the school can see its invoice, the other school cannot', (await api('GET', `/school-portal/invoices/${invoiceId}`, { token: tokenA })).status === 200 && (await api('GET', `/school-portal/invoices/${invoiceId}`, { token: tokenB })).status === 404);

  const o2full = await api('POST', `/school-supplier/orders/${o2.json.id}/confirm`, { token: owner, body: {} });
  check('the 200-book order is confirmed as asked', o2full.status === 200 && o2full.json.total === 9000, o2full);
  const lowStock = await api('POST', `/school-supplier/orders/${o2.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
  check('delivering more than is in stock is refused, and the order stays confirmed', lowStock.status === 400 && /Not enough stock/.test(lowStock.json.message) && (await api('GET', `/school-supplier/orders/${o2.json.id}`, { token: owner })).json.status === 'CONFIRMED', lowStock);
  const cancelled = await api('POST', `/school-supplier/orders/${o2.json.id}/cancel`, { token: owner, body: { reason: 'Out of stock' } });
  check('the supplier can cancel a confirmed order', cancelled.status === 200 && cancelled.json.status === 'CANCELLED', cancelled);

  const o4 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: book.id, quantity: 150 }] } });
  check('a new order that takes the school past its credit limit (4600 owed + 6750 > 10000) is flagged', o4.status === 201 && o4.json.overCreditLimit === true, o4.json);
  await api('POST', `/school-supplier/orders/${o4.json.id}/cancel`, { token: owner, body: { reason: 'test over' } });

  section('7. Payments and receipts');
  check('a cheque with no cheque number is refused', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 2000, method: 'CHEQUE' } })).status === 400);
  const p1 = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 2000, method: 'CHEQUE', reference: 'CHQ-0042', bankName: 'Test Bank', chequeDate: nairobi() } });
  check('a part payment by cheque gets a receipt number', p1.status === 201 && /^RC-\d{4}-\d{4}$/.test(p1.json.receiptNumber) && p1.json.allocated === 2000 && p1.json.onAccount === 0, p1);
  const afterP1 = await api('GET', `/school-supplier/invoices/${invoiceId}`, { token: owner });
  check('the invoice is now part paid with 2600 still owing', afterP1.json.status === 'PARTIALLY_PAID' && afterP1.json.amountPaid === 2000 && afterP1.json.balance === 2600, afterP1.json);
  const p2 = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 3000, method: 'BANK_TRANSFER', reference: 'TRF-9' } });
  check('paying more than is owed settles the invoice and keeps 400 as credit on the account', p2.status === 201 && p2.json.allocated === 2600 && p2.json.onAccount === 400, p2);
  const afterP2 = await api('GET', `/school-supplier/invoices/${invoiceId}`, { token: owner });
  check('the invoice is paid', afterP2.json.status === 'PAID' && afterP2.json.balance === 0, afterP2.json);
  const schoolNow = await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner });
  check('the school owes nothing and has 400 credit', schoolNow.json.owed === 0 && schoolNow.json.credit === 400, schoolNow.json);

  const bounced = await api('POST', `/school-supplier/payments/${p2.json.id}/bounce`, { token: owner, body: { reason: 'Transfer reversed' } });
  check('a payment that did not clear can be marked bounced', bounced.status === 200 && bounced.json.status === 'BOUNCED', bounced);
  check('a second bounce is refused', (await api('POST', `/school-supplier/payments/${p2.json.id}/bounce`, { token: owner, body: { reason: 'again' } })).status === 409);
  const afterBounce = await api('GET', `/school-supplier/invoices/${invoiceId}`, { token: owner });
  check('the invoice owes the money again (paid 2000, 2600 owing)', afterBounce.json.status === 'PARTIALLY_PAID' && afterBounce.json.amountPaid === 2000 && afterBounce.json.balance === 2600, afterBounce.json);
  const schoolAfter = await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner });
  check('and the credit is gone', schoolAfter.json.owed === 2600 && schoolAfter.json.credit === 0, schoolAfter.json);
  check('an invoice with a payment on it cannot be voided', (await api('POST', `/school-supplier/invoices/${invoiceId}/void`, { token: owner, body: { reason: 'oops' } })).status === 409);

  section('8. Two payments at the same moment cannot overpay an invoice');
  const race = await Promise.all([1, 2].map(() => api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 2000, method: 'CASH' } })));
  const finalInv = await api('GET', `/school-supplier/invoices/${invoiceId}`, { token: owner });
  check('both are received but the invoice is never paid beyond its total', race.every((r) => r.status === 201) && finalInv.json.amountPaid <= finalInv.json.total && finalInv.json.status === 'PAID', [race.map((r) => r.json.allocated), finalInv.json]);
  const credit = await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner });
  check('the surplus (4000 - 2600 = 1400) stays as credit', credit.json.credit === 1400, credit.json);

  section('9. Statement, receivables and the school\'s own view');
  const st = await api('GET', `/school-supplier/schools/${a.json.id}/statement`, { token: owner });
  const lastEntry = st.json.entries?.[st.json.entries.length - 1];
  check('the statement lists the invoice and the payments that count (not the bounced one)', st.status === 200 && st.json.entries.filter((e) => e.kind === 'INVOICE').length === 1 && st.json.entries.filter((e) => e.kind === 'PAYMENT').length === 3 && !st.json.entries.some((e) => e.reference === p2.json.receiptNumber), st.json.entries);
  check('the closing balance is the invoice less all payments: 4600 - 2000 - 2000 - 2000 = -1400 (credit)', st.json.closingBalance === -1400 && lastEntry.balance === -1400, [st.json.closingBalance, lastEntry]);
  const myStatement = await api('GET', '/school-portal/statement', { token: tokenA });
  check('the school sees the same statement', myStatement.status === 200 && myStatement.json.closingBalance === -1400, myStatement);
  const receipts = await api('GET', '/school-portal/receipts', { token: tokenA });
  check('the school lists its receipts, the other school has none', receipts.status === 200 && receipts.json.length >= 3 && (await api('GET', '/school-portal/receipts', { token: tokenB })).json.length === 0);
  const oneReceipt = await api('GET', `/school-portal/receipts/${p1.json.id}`, { token: tokenA });
  check('a receipt can be opened with the business letterhead', oneReceipt.status === 200 && oneReceipt.json.receiptNumber === p1.json.receiptNumber && oneReceipt.json.business?.name === me.name, oneReceipt.json);
  check('the other school cannot open it', (await api('GET', `/school-portal/receipts/${p1.json.id}`, { token: tokenB })).status === 404);
  const recv = await api('GET', '/school-supplier/receivables', { token: owner });
  check('receivables lists only schools owing or holding credit', recv.status === 200 && recv.json.rows.some((r) => r.schoolId === a.json.id && r.credit === 1400), recv.json);

  section('10. Document numbers do not repeat');
  const nums = await sql.query(
    `SELECT n FROM (SELECT "orderNumber" AS n FROM school_orders WHERE "organizationId" = $1 UNION ALL SELECT "invoiceNumber" FROM supplier_invoices WHERE "organizationId" = $1 UNION ALL SELECT "receiptNumber" FROM supplier_payments WHERE "organizationId" = $1) x`,
    [orgId],
  );
  check('every order, invoice and receipt number is different', new Set(nums.rows.map((r) => r.n)).size === nums.rows.length, nums.rows.length);

  section('11. Suspending, PINs and lock-out');
  const suspended = await api('PATCH', `/school-supplier/schools/${b.json.id}`, { token: owner, body: { status: 'SUSPENDED' } });
  check('a school can be suspended', suspended.status === 200 && suspended.json.status === 'SUSPENDED', suspended);
  check('a suspended school is turned away at once, even with a valid token', (await api('GET', '/school-portal/price-list', { token: tokenB })).status === 401);
  await api('PATCH', `/school-supplier/schools/${b.json.id}`, { token: owner, body: { status: 'ACTIVE' } });
  console.log('  (waiting a minute so the sign-in limit resets)');
  await sleep(62_000);
  const wrongPin = pinB === '5555' ? '5556' : '5555';
  let last;
  for (let i = 0; i < 5; i++) last = await api('POST', '/school-auth/login', { body: { slug, phone: phoneB, pin: wrongPin } });
  check('five wrong PINs lock the school', last.status === 429 || last.status === 401, last);
  await sleep(62_000);
  const locked = await api('POST', '/school-auth/login', { body: { slug, phone: phoneB, pin: pinB } });
  check('while locked even the right PIN is refused', locked.status === 429, locked);
  const reset = await api('POST', `/school-supplier/schools/${b.json.id}/reset-pin`, { token: owner });
  check('the supplier can issue a new PIN', reset.status === 200 && /^\d{4}$/.test(reset.json.temporaryPin), reset);
  const back = await api('POST', '/school-auth/login', { body: { slug, phone: phoneB, pin: reset.json.temporaryPin } });
  check('the new PIN works and clears the lock', back.status === 200, back);
  const disabled = await api('PUT', '/school-supplier/portal', { token: owner, body: { slug, displayName: `Jaribu Stationers ${tag}`, enabled: false } });
  check('a portal can be switched off', disabled.status === 200 && disabled.json.enabled === false, disabled);
  const closed = await api('POST', '/school-auth/login', { body: { slug, phone: phoneA, pin: pinA } });
  check('and then nobody can sign in', closed.status === 401, closed);
  await api('PUT', '/school-supplier/portal', { token: owner, body: { slug, displayName: `Jaribu Stationers ${tag}`, enabled: true } });

  section('12. Delivering in parts: the balance, a note and an invoice for each drop');
  await receive(book.id, 200, 30);
  const o5 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lpoNumber: 'LPO-88', lines: [{ variantId: book.id, quantity: 100 }, { variantId: pen.id, quantity: 40 }] } });
  const o5book = o5.json.lines.find((l) => l.sku === `EXB-${tag}`);
  const o5pen = o5.json.lines.find((l) => l.sku === `PEN-${tag}`);
  await api('POST', `/school-supplier/orders/${o5.json.id}/confirm`, { token: owner, body: {} });
  const bad41 = await api('POST', `/school-supplier/orders/${o5.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno', lines: [{ lineId: o5book.id, quantity: 101 }] } });
  check('delivering more than was agreed is refused, saying how much is left', bad41.status === 400 && /only 100 left/.test(bad41.json.message), bad41.json);
  const stockPart0 = await stockOf(book.id);
  const part1 = await api('POST', `/school-supplier/orders/${o5.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno', lines: [{ lineId: o5book.id, quantity: 60 }] } });
  check('delivering 60 of 100 books (and the full 40 pens) leaves the order partly delivered', part1.status === 200 && part1.json.status === 'PARTIALLY_DELIVERED' && part1.json.hasBalance === true && part1.json.deliveries.length === 1, part1.json);
  const pb = part1.json.lines.find((l) => l.id === o5book.id);
  const pp = part1.json.lines.find((l) => l.id === o5pen.id);
  check('the order shows what is delivered and what is still to come (books 60 / 40 left, pens 40 / none)', pb.quantityDelivered === 60 && pb.balance === 40 && pp.quantityDelivered === 40 && pp.balance === 0, [pb, pp]);
  check('stock came down by 60 books only', (await stockOf(book.id)) === stockPart0 - 60);
  const d1 = part1.json.deliveries[0];
  check('that drop has its own delivery note and its own invoice (60 x 45 + 40 x 20 = 3500)', /^DN-\d{4}-\d{4}$/.test(d1.deliveryNoteNumber) && d1.invoice?.total === 3500 && d1.sequence === 1, d1);
  check('the school sees the balance too', (await api('GET', `/school-portal/orders/${o5.json.id}`, { token: tokenA })).json.lines.find((l) => l.id === o5book.id).balance === 40);
  check('the partly delivered order cannot be cancelled (close the balance instead)', (await api('POST', `/school-supplier/orders/${o5.json.id}/cancel`, { token: owner, body: { reason: 'no longer needed' } })).status === 409);
  const listPartial = await api('GET', '/school-supplier/orders?status=PARTIALLY_DELIVERED', { token: owner });
  check('it can be found in the list of orders with a balance', listPartial.status === 200 && listPartial.json.some((o) => o.id === o5.json.id), listPartial.json.length);

  // the invoice is also an ordinary sale
  const inv1 = await api('GET', `/school-supplier/invoices/${d1.invoice.id}`, { token: owner });
  check('the invoice knows the delivery note it goes with', inv1.json.order?.deliveryNoteNumber === d1.deliveryNoteNumber && inv1.json.saleId, inv1.json);
  const sale1 = (await sql.query('SELECT s.id, s.status, s.total::float AS total, s."branchId", (SELECT method FROM sale_payments WHERE "saleId" = s.id LIMIT 1) AS method, (SELECT count(*)::int FROM sale_line_items WHERE "saleId" = s.id) AS lines FROM sales s WHERE s."clientId" = $1', [`school-invoice-${d1.invoice.id}`])).rows[0];
  check('it was recorded as a completed sale of the same amount, on account, with its lines', sale1 && sale1.status === 'COMPLETED' && sale1.total === 3500 && sale1.method === 'ACCOUNT' && sale1.lines === 2 && sale1.branchId === branchId, sale1);
  const saleApi = await api('GET', `/sales/${sale1.id}`, { token: owner });
  check('the sale shows in Sales', saleApi.status === 200 && Number(saleApi.json.total) === 3500, saleApi.status);
  const salesList = await api('GET', '/sales', { token: owner });
  check('and in the sales list', salesList.status === 200 && JSON.stringify(salesList.json).includes(sale1.id));
  check('no stock was taken a second time for the sale', (await stockOf(book.id)) === stockPart0 - 60);

  // the delivery note
  const note1 = await api('GET', `/school-supplier/deliveries/${d1.id}`, { token: owner });
  const nb = note1.json.lines?.find((l) => l.id === o5book.id);
  check('the delivery note shows ordered 100, delivered before 0, now 60, still to come 40', note1.status === 200 && nb.ordered === 100 && nb.before === 0 && nb.now === 60 && nb.balance === 40 && note1.json.invoice?.invoiceNumber === d1.invoice.invoiceNumber, note1.json);
  check('it carries the business letterhead and who received the goods', note1.json.business?.name === me.name && note1.json.receivedByName === 'Mr Otieno', note1.json.business);
  check('the school can open its delivery note, the other school cannot', (await api('GET', `/school-portal/deliveries/${d1.id}`, { token: tokenA })).status === 200 && (await api('GET', `/school-portal/deliveries/${d1.id}`, { token: tokenB })).status === 404);

  // the school confirms receipt
  check('the other school cannot confirm it', (await api('POST', `/school-portal/deliveries/${d1.id}/confirm-received`, { token: tokenB, body: { name: 'Someone' } })).status === 404);
  check('a name is needed', (await api('POST', `/school-portal/deliveries/${d1.id}/confirm-received`, { token: tokenA, body: {} })).status === 400);
  const conf = await api('POST', `/school-portal/deliveries/${d1.id}/confirm-received`, { token: tokenA, body: { name: 'Mrs Akinyi', note: 'All boxes sealed' } });
  check('the school confirms the goods arrived', conf.status === 200 && conf.json.deliveries[0].schoolConfirmedBy === 'Mrs Akinyi' && Boolean(conf.json.deliveries[0].schoolConfirmedAt), conf.json);
  check('it cannot be confirmed twice', (await api('POST', `/school-portal/deliveries/${d1.id}/confirm-received`, { token: tokenA, body: { name: 'Mrs Akinyi' } })).status === 409);
  check('the supplier sees the confirmation on the order', (await api('GET', `/school-supplier/orders/${o5.json.id}`, { token: owner })).json.deliveries[0].schoolConfirmedBy === 'Mrs Akinyi');

  // the rest follows
  const part2 = await api('POST', `/school-supplier/orders/${o5.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
  check('delivering again takes the whole balance and completes the order', part2.status === 200 && part2.json.status === 'DELIVERED' && part2.json.hasBalance === false && part2.json.deliveries.length === 2, part2.json);
  const d2 = part2.json.deliveries[1];
  check('the second drop has its own number and invoice (40 x 45 = 1800)', d2.sequence === 2 && d2.deliveryNoteNumber !== d1.deliveryNoteNumber && d2.invoice?.total === 1800 && d2.invoice.id !== d1.invoice.id, d2);
  check('the books delivered add up to the 100 ordered', part2.json.lines.find((l) => l.id === o5book.id).quantityDelivered === 100);
  const note2 = await api('GET', `/school-supplier/deliveries/${d2.id}`, { token: owner });
  const nb2 = note2.json.lines?.find((l) => l.id === o5book.id);
  check('the second delivery note shows 60 delivered before, 40 now, none to come', nb2.before === 60 && nb2.now === 40 && nb2.balance === 0, nb2);
  check('a finished order cannot be delivered again', (await api('POST', `/school-supplier/orders/${o5.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } })).status === 409);
  check('each invoice is its own sale', (await sql.query("SELECT count(*)::int AS n FROM sales WHERE \"clientId\" LIKE 'school-invoice-%' AND \"organizationId\" = $1 AND status = 'COMPLETED'", [orgId])).rows[0].n >= 2);

  // two people delivering at the same moment cannot deliver the same balance twice
  const o7 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: pen.id, quantity: 10 }] } });
  await api('POST', `/school-supplier/orders/${o7.json.id}/confirm`, { token: owner, body: {} });
  const pensBefore = await stockOf(pen.id);
  const twice = await Promise.all([1, 2].map(() => api('POST', `/school-supplier/orders/${o7.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } })));
  check('two deliveries of the same balance at once: one goes through, the other is refused', twice.filter((r) => r.status === 200).length === 1 && (await stockOf(pen.id)) === pensBefore - 10, twice.map((r) => r.status));

  // giving up the balance
  const o6 = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: book.id, quantity: 50 }] } });
  await api('POST', `/school-supplier/orders/${o6.json.id}/confirm`, { token: owner, body: {} });
  check('an order with nothing delivered cannot have its balance closed', (await api('POST', `/school-supplier/orders/${o6.json.id}/close-balance`, { token: owner, body: { note: 'not needed' } })).status === 409);
  const o6book = o6.json.lines[0];
  const part6 = await api('POST', `/school-supplier/orders/${o6.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno', lines: [{ lineId: o6book.id, quantity: 20 }] } });
  check('20 of 50 delivered', part6.status === 200 && part6.json.status === 'PARTIALLY_DELIVERED', part6.json);
  check('closing the balance needs a reason', (await api('POST', `/school-supplier/orders/${o6.json.id}/close-balance`, { token: owner, body: {} })).status === 400);
  const closed6 = await api('POST', `/school-supplier/orders/${o6.json.id}/close-balance`, { token: owner, body: { note: 'Supplier out of stock for the rest' } });
  check('closing the balance finishes the order at what was delivered (20 x 45 = 900)', closed6.status === 200 && closed6.json.status === 'DELIVERED' && closed6.json.hasBalance === false && closed6.json.total === 900 && Boolean(closed6.json.balanceClosedAt), closed6.json);
  check('it cannot be closed twice, or delivered further', (await api('POST', `/school-supplier/orders/${o6.json.id}/close-balance`, { token: owner, body: { note: 'again' } })).status === 409 && (await api('POST', `/school-supplier/orders/${o6.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } })).status === 409);

  // voiding the invoice cancels its sale
  const inv6 = part6.json.deliveries[0].invoice;
  const sale6 = (await sql.query('SELECT id FROM sales WHERE "clientId" = $1', [`school-invoice-${inv6.id}`])).rows[0];
  const voided6 = await api('POST', `/school-supplier/invoices/${inv6.id}/void`, { token: owner, body: { reason: 'Raised in error' } });
  check('voiding an invoice voids the sale it was recorded as', voided6.status === 200 && (await sql.query('SELECT status FROM sales WHERE id = $1', [sale6.id])).rows[0].status === 'VOIDED', voided6.json);

  // old data: a delivered order from before this change was given its delivery, and one delivered short can be finished
  const legacy = (await sql.query("SELECT count(*)::int AS n FROM school_orders o WHERE o.status = 'DELIVERED' AND o.\"organizationId\" = $1 AND NOT EXISTS (SELECT 1 FROM school_deliveries d WHERE d.\"orderId\" = o.id)", [orgId])).rows[0].n;
  check('every delivered order has at least one delivery behind it', legacy === 0, legacy);
  for (const t of ['school_deliveries', 'school_delivery_lines']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
