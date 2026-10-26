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
  for (const t of ['school_portals', 'supplier_schools', 'school_orders', 'school_order_lines', 'school_deliveries', 'school_delivery_lines', 'supplier_credit_notes', 'supplier_credit_note_lines', 'supplier_invoices', 'supplier_invoice_lines', 'supplier_payments', 'supplier_payment_allocations', 'document_counters']) {
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
  const stockView = await api('GET', `/school-supplier/orders/${o5.json.id}/stock?branchId=${branchId}`, { token: owner });
  check('the order shows what is in stock for each line, at the branch asked about', stockView.status === 200 && stockView.json.lines.find((l) => l.lineId === o5book.id)?.available === (await stockOf(book.id)) && stockView.json.lines.find((l) => l.lineId === o5pen.id)?.available === (await stockOf(pen.id)), stockView.json);
  check('a branch with none of it shows 0, not an error', (await api('GET', `/school-supplier/orders/${o5.json.id}/stock?branchId=00000000-0000-4000-8000-000000000000`, { token: owner })).json.lines?.every((l) => l.available === 0));
  check('the stock view needs a branch and a real order', (await api('GET', `/school-supplier/orders/${o5.json.id}/stock`, { token: owner })).status === 400 && (await api('GET', `/school-supplier/orders/00000000-0000-4000-8000-000000000000/stock?branchId=${branchId}`, { token: owner })).status === 404);
  check('a school cannot see the supplier\'s stock', (await api('GET', `/school-supplier/orders/${o5.json.id}/stock?branchId=${branchId}`, { token: tokenA })).status === 401);
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

  section('13. Credit notes: goods returned, short deliveries and price corrections');
  await receive(book.id, 300, 30);
  await receive(pen.id, 200, 10);
  const mkDelivered = async (lines) => {
    const o = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines } });
    await api('POST', `/school-supplier/orders/${o.json.id}/confirm`, { token: owner, body: {} });
    const d = await api('POST', `/school-supplier/orders/${o.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
    return d.json.deliveries[0];
  };
  const dlv13 = await mkDelivered([{ variantId: book.id, quantity: 20 }, { variantId: pen.id, quantity: 10 }]);
  const invC = dlv13.invoice;
  check('an invoice of 1,100 to credit against (20 books x 45 + 10 pens x 20)', invC.total === 1100, invC);
  const schoolBefore = (await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner })).json;
  const cr013 = await api('GET', `/school-supplier/invoices/${invC.id}/creditable`, { token: owner });
  const crBook = cr013.json.lines.find((l) => l.description.includes('Exercise book'));
  const crPen = cr013.json.lines.find((l) => l.description.includes('Blue pen'));
  check('it says what can still be credited on each line', cr013.status === 200 && cr013.json.remaining === 1100 && crBook.available === 20 && crPen.available === 10 && crPen.canRestock === true, cr013.json);

  check('a school cannot make credit notes', (await api('POST', '/school-supplier/credit-notes', { token: tokenA, body: { invoiceId: invC.id, reason: 'RETURNED', lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 1 }] } })).status === 401);
  check('crediting more than was invoiced is refused, saying how many are left', (await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'RETURNED', lines: [{ invoiceLineId: crBook.invoiceLineId, quantity: 21 }] } })).json.message?.includes('only 20 left'));
  check('goods put back in stock need a branch', (await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'RETURNED', lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 4, restock: 4 }] } })).status === 400);
  check('more put back than credited is refused', (await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'RETURNED', branchId, lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 2, restock: 3 }] } })).status === 400);
  check('a reason must be one of the listed ones', (await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'BECAUSE', lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 1 }] } })).status === 400);
  check('nothing was changed by the refusals', (await sql.query('SELECT count(*)::int AS n FROM supplier_credit_notes WHERE "invoiceId" = $1', [invC.id])).rows[0].n === 0);

  const pensBefore13 = await stockOf(pen.id);
  const booksBefore13 = await stockOf(book.id);
  const cn1 = await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'RETURNED', note: 'Wrong colour, sent back', branchId, lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 4, restock: 4 }] } });
  check('4 pens come back: a credit note of 80 with its own number', cn1.status === 201 && /^CN-\d{4}-\d{4}$/.test(cn1.json.creditNumber) && cn1.json.total === 80 && cn1.json.restocked === true && cn1.json.invoice.invoiceNumber === invC.invoiceNumber, cn1.json);
  check('the 4 pens went back into stock', (await stockOf(pen.id)) === pensBefore13 + 4);
  const movement13 = await sql.query(`SELECT type, "quantityDelta" FROM inventory_transactions WHERE "referenceId" = $1`, [cn1.json.id]);
  check('and the stock record says they were returned', movement13.rows.length === 1 && movement13.rows[0].type === 'RETURN' && Number(movement13.rows[0].quantityDelta) === 4, movement13.rows);
  const invAfter1 = (await api('GET', `/school-supplier/invoices/${invC.id}`, { token: owner })).json;
  check('the invoice owes 80 less: credited 80, owing 1,020, part settled', invAfter1.creditAmount === 80 && invAfter1.balance === 1020 && invAfter1.status === 'PARTIALLY_PAID' && invAfter1.creditNotes.length === 1 && invAfter1.total === 1100, invAfter1);
  const schoolAfter1 = (await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner })).json;
  check('the school owes 80 less', Math.round((schoolBefore.owed - schoolAfter1.owed) * 100) / 100 === 80, [schoolBefore.owed, schoolAfter1.owed]);

  const cn2 = await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'DAMAGED', lines: [{ invoiceLineId: crBook.invoiceLineId, quantity: 5 }] } });
  check('5 damaged books are credited (225) with nothing put back in stock', cn2.status === 201 && cn2.json.total === 225 && cn2.json.restocked === false && (await stockOf(book.id)) === booksBefore13, cn2.json);
  const cr113 = await api('GET', `/school-supplier/invoices/${invC.id}/creditable`, { token: owner });
  check('what is left to credit goes down: 15 books, 6 pens, 795 standing', cr113.json.lines.find((l) => l.description.includes('Exercise book')).available === 15 && cr113.json.lines.find((l) => l.description.includes('Blue pen')).available === 6 && cr113.json.remaining === 795, cr113.json);
  check('two credit notes never share a number', cn1.json.creditNumber !== cn2.json.creditNumber);

  // the school's account
  const stmt13 = (await api('GET', `/school-supplier/schools/${a.json.id}/statement`, { token: owner })).json;
  const stmtCn = stmt13.entries.filter((e) => e.kind === 'CREDIT_NOTE');
  check('the statement lists the credit notes as credits, with the invoice they are against', stmtCn.length >= 2 && stmtCn.some((e) => e.reference === cn1.json.creditNumber && e.credit === 80 && e.description.includes(invC.invoiceNumber)), stmtCn);
  const schoolNow13 = (await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner })).json;
  check('and the closing balance agrees with what the school owes now (owed less credit)', Math.abs(stmt13.closingBalance - (schoolNow13.owed - schoolNow13.credit)) < 0.01, [stmt13.closingBalance, schoolNow13.owed, schoolNow13.credit]);
  const myStmt13 = (await api('GET', '/school-portal/statement', { token: tokenA })).json;
  check('the school sees the same credit notes on its statement', myStmt13.entries.some((e) => e.kind === 'CREDIT_NOTE' && e.reference === cn1.json.creditNumber));
  check('the school can see and open its credit notes; the other school cannot', (await api('GET', '/school-portal/credit-notes', { token: tokenA })).json.some((c) => c.id === cn1.json.id) && (await api('GET', `/school-portal/credit-notes/${cn1.json.id}`, { token: tokenA })).json.business?.name === me.name && (await api('GET', `/school-portal/credit-notes/${cn1.json.id}`, { token: tokenB })).status === 404 && (await api('GET', '/school-portal/credit-notes', { token: tokenB })).json.length === 0);
  const one13 = await api('GET', `/school-supplier/credit-notes/${cn1.json.id}`, { token: owner });
  check('a credit note opens with the business letterhead, ready to print', one13.status === 200 && one13.json.business?.name === me.name && one13.json.lines.length === 1 && one13.json.reasonText === 'Goods returned', one13.json);
  check('the supplier can list credit notes by school', (await api('GET', `/school-supplier/credit-notes?schoolId=${a.json.id}`, { token: owner })).json.length >= 2 && (await api('GET', `/school-supplier/credit-notes?schoolId=${b.json.id}`, { token: owner })).json.length === 0);

  // the sale the invoice became is refunded by the same amount
  const refunds13 = await sql.query(`SELECT r.amount::float AS amount FROM refunds r JOIN sales s ON s.id = r."saleId" JOIN supplier_invoices i ON i."saleId" = s.id WHERE i.id = $1 ORDER BY r.amount`, [invC.id]);
  check('the sale it was recorded as shows refunds of 80 and 225', refunds13.rows.length === 2 && refunds13.rows[0].amount === 80 && refunds13.rows[1].amount === 225, refunds13.rows);

  // payments now stop at what is really owed
  const owedNow13 = (await api('GET', `/school-supplier/invoices/${invC.id}`, { token: owner })).json.balance;
  check('what the invoice owes now is 795', owedNow13 === 795, owedNow13);
  const pay13 = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 795, method: 'CASH', allocations: [{ invoiceId: invC.id, amount: 795 }] } });
  const paidInv = (await api('GET', `/school-supplier/invoices/${invC.id}`, { token: owner })).json;
  check('paying that settles the invoice: paid 795, credited 305, status paid', pay13.status === 201 && paidInv.status === 'PAID' && paidInv.amountPaid === 795 && paidInv.balance === 0, paidInv);
  const creditBeforeLate = (await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner })).json.credit;
  const cn3 = await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'PRICE_ERROR', lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 6 }] } });
  const creditAfterLate = (await api('GET', `/school-supplier/schools/${a.json.id}`, { token: owner })).json.credit;
  check('a credit note on an invoice that is already paid becomes credit on the school\'s account (120)', cn3.status === 201 && cn3.json.total === 120 && Math.round((creditAfterLate - creditBeforeLate) * 100) / 100 === 120, [creditBeforeLate, creditAfterLate]);
  check('and once everything is credited nothing more can be', (await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invC.id, reason: 'OTHER', lines: [{ invoiceLineId: crPen.invoiceLineId, quantity: 1 }] } })).status === 400);
  check('the 10 pens: 4 returned + 6 price-corrected leaves none to credit', (await api('GET', `/school-supplier/invoices/${invC.id}/creditable`, { token: owner })).json.lines.find((l) => l.description.includes('Blue pen')).available === 0);

  // an invoice credited in full before anything was paid
  const dlv2 = await mkDelivered([{ variantId: pen.id, quantity: 10 }]);
  const cr213 = await api('GET', `/school-supplier/invoices/${dlv2.invoice.id}/creditable`, { token: owner });
  const full13 = await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: dlv2.invoice.id, reason: 'SHORT_DELIVERY', lines: cr213.json.lines.map((l) => ({ invoiceLineId: l.invoiceLineId, quantity: l.available })) } });
  const fullInv = (await api('GET', `/school-supplier/invoices/${dlv2.invoice.id}`, { token: owner })).json;
  check('crediting an invoice in full13 leaves nothing owing and the invoice settled', full13.status === 201 && full13.json.total === 200 && fullInv.balance === 0 && fullInv.status === 'PAID' && fullInv.creditAmount === 200, fullInv);
  check('an invoice with a credit note cannot be cancelled', (await api('POST', `/school-supplier/invoices/${dlv2.invoice.id}/void`, { token: owner, body: { reason: 'oops' } })).status === 409);
  const refundsFull = await sql.query(`SELECT count(*)::int AS n FROM refunds r JOIN supplier_invoices i ON i."saleId" = r."saleId" WHERE i.id = $1 AND r.amount = 200`, [dlv2.invoice.id]);
  check('a credit of the whole invoice refunds the whole sale (so KRA gets a credit note by itself)', refundsFull.rows[0].n === 1);

  // a cancelled invoice cannot be credited
  const dlv3 = await mkDelivered([{ variantId: pen.id, quantity: 2 }]);
  const cr313 = await api('GET', `/school-supplier/invoices/${dlv3.invoice.id}/creditable`, { token: owner });
  await api('POST', `/school-supplier/invoices/${dlv3.invoice.id}/void`, { token: owner, body: { reason: 'Raised in error' } });
  check('a cancelled invoice cannot be credited', (await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: dlv3.invoice.id, reason: 'OTHER', lines: [{ invoiceLineId: cr313.json.lines[0].invoiceLineId, quantity: 1 }] } })).status === 409);

  // two credit notes at the same moment cannot take back more than was invoiced
  const dlv4 = await mkDelivered([{ variantId: pen.id, quantity: 10 }]);
  const cr413 = await api('GET', `/school-supplier/invoices/${dlv4.invoice.id}/creditable`, { token: owner });
  const race13 = await Promise.all([1, 2].map(() => api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: dlv4.invoice.id, reason: 'OTHER', lines: [{ invoiceLineId: cr413.json.lines[0].invoiceLineId, quantity: 10 }] } })));
  const afterRace = (await api('GET', `/school-supplier/invoices/${dlv4.invoice.id}`, { token: owner })).json;
  check('two credit notes for the same goods at once: one13 is made, the other refused, nothing credited twice', race13.filter((r) => r.status === 201).length === 1 && afterRace.creditAmount === 200, [race13.map((r) => r.status), afterRace.creditAmount]);
  for (const t of ['supplier_credit_notes', 'supplier_credit_note_lines']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }

  section('14. Quotations: draft, issue, the school accepts, revise, expire');
  const qBook = { variantId: book.id, quantity: 30, unitPrice: 40 };
  const qPen = { variantId: pen.id, quantity: 20 };
  check('a quotation to a school that does not exist is refused', (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: '00000000-0000-4000-8000-000000000000', lines: [qPen] } })).status === 404);
  check('a quotation with no items is refused', (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [] } })).status === 400);
  check('a product at two prices in one quotation is refused', (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [{ variantId: book.id, quantity: 1, unitPrice: 40 }, { variantId: book.id, quantity: 1, unitPrice: 42 }] } })).status === 400);
  check('an unknown product is refused', (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [{ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] } })).status === 400);
  check('a school cannot make quotations', (await api('POST', '/school-supplier/quotes', { token: tokenA, body: { schoolId: a.json.id, lines: [qPen] } })).status === 401);

  const q1 = await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, validUntil: nairobi(10), terms: 'Delivery within 7 days of the order.', lines: [qBook, qPen, { variantId: pen.id, quantity: 5 }] } });
  check('a draft quotation is made: books at the quoted 40, pens at the school price 20 (same product listed twice is joined), total 30 x 40 + 25 x 20 = 1700', q1.status === 201 && q1.json.status === 'DRAFT' && q1.json.quoteNumber === null && q1.json.total === 1700 && q1.json.lines.length === 2, q1.json);
  check('a school cannot see a draft', (await api('GET', '/school-portal/quotes', { token: tokenA })).json.length === 0 && (await api('GET', `/school-portal/quotes/${q1.json.id}`, { token: tokenA })).status === 404);
  const q1b = await api('PUT', `/school-supplier/quotes/${q1.json.id}`, { token: owner, body: { schoolId: a.json.id, validUntil: nairobi(10), terms: 'Delivery within 7 days of the order.', lines: [qBook, qPen] } });
  check('a draft can be changed (20 pens now): total 30 x 40 + 20 x 20 = 1600', q1b.status === 200 && q1b.json.total === 1600 && q1b.json.lines.length === 2, q1b.json);

  const issued = await api('POST', `/school-supplier/quotes/${q1.json.id}/issue`, { token: owner });
  check('issuing gives it a number and freezes it', issued.status === 200 && /^QT-\d{4}-\d{4}$/.test(issued.json.quoteNumber) && issued.json.status === 'ISSUED' && issued.json.issueDate === nairobi() && issued.json.validUntil === nairobi(10), issued.json);
  check('an issued quotation cannot be changed, deleted or issued again', (await api('PUT', `/school-supplier/quotes/${q1.json.id}`, { token: owner, body: { schoolId: a.json.id, lines: [qPen] } })).status === 409 && (await api('DELETE', `/school-supplier/quotes/${q1.json.id}`, { token: owner })).status === 409 && (await api('POST', `/school-supplier/quotes/${q1.json.id}/issue`, { token: owner })).status === 409);
  const draftDel = await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [qPen] } });
  check('a draft can be deleted', (await api('DELETE', `/school-supplier/quotes/${draftDel.json.id}`, { token: owner })).status === 200);
  check('the school sees the issued quotation with the supplier\'s letterhead; the other school does not', (await api('GET', '/school-portal/quotes', { token: tokenA })).json.some((q) => q.id === q1.json.id) && (await api('GET', `/school-portal/quotes/${q1.json.id}`, { token: tokenA })).json.business?.name === me.name && (await api('GET', `/school-portal/quotes/${q1.json.id}`, { token: tokenB })).status === 404 && (await api('GET', '/school-portal/quotes', { token: tokenB })).json.length === 0);
  check('another school cannot accept it', (await api('POST', `/school-portal/quotes/${q1.json.id}/accept`, { token: tokenB, body: {} })).status === 404);

  const accepted = await api('POST', `/school-portal/quotes/${q1.json.id}/accept`, { token: tokenA, body: { lpoNumber: 'LPO-Q1', notes: 'Please deliver to the bursar' } });
  check('the school accepts: the quotation is accepted and an order is made from it', accepted.status === 200 && accepted.json.status === 'ACCEPTED' && accepted.json.decidedBy === 'SCHOOL' && /^SO-\d{4}-\d{4}$/.test(accepted.json.order?.orderNumber), accepted.json);
  const qOrder = (await api('GET', `/school-supplier/orders/${accepted.json.order.id}`, { token: owner })).json;
  check('the order carries the quoted prices (books at 40, not the list price 45), the LPO number, and waits for the supplier', qOrder.status === 'SUBMITTED' && qOrder.lpoNumber === 'LPO-Q1' && qOrder.total === 1600 && qOrder.lines.find((l) => l.sku === `EXB-${tag}`).unitPrice === 40, qOrder);
  check('it cannot be accepted or declined again', (await api('POST', `/school-portal/quotes/${q1.json.id}/accept`, { token: tokenA, body: {} })).status === 409 && (await api('POST', `/school-portal/quotes/${q1.json.id}/decline`, { token: tokenA, body: {} })).status === 409);
  check('an accepted quotation cannot be revised', (await api('POST', `/school-supplier/quotes/${q1.json.id}/revise`, { token: owner })).status === 409);
  const confirmedQ = await api('POST', `/school-supplier/orders/${qOrder.id}/confirm`, { token: owner, body: {} });
  check('the supplier confirms it like any other order, still at 1,600', confirmedQ.status === 200 && confirmedQ.json.total === 1600, confirmedQ.json);

  // a decline, then a revision that replaces it
  const q2 = (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [{ variantId: book.id, quantity: 10, unitPrice: 44 }] } })).json;
  await api('POST', `/school-supplier/quotes/${q2.id}/issue`, { token: owner });
  const dec = await api('POST', `/school-portal/quotes/${q2.id}/decline`, { token: tokenA, body: { reason: 'Price too high' } });
  check('the school declines with a reason', dec.status === 200 && dec.json.status === 'DECLINED' && dec.json.decisionNote === 'Price too high' && dec.json.order === null, dec.json);
  const rev = await api('POST', `/school-supplier/quotes/${q2.id}/revise`, { token: owner });
  check('a declined quotation can be revised into a new draft that points back to it', rev.status === 200 && rev.json.status === 'DRAFT' && rev.json.revisionOf?.id === q2.id && rev.json.lines.length === 1, rev.json);
  const rev2 = await api('PUT', `/school-supplier/quotes/${rev.json.id}`, { token: owner, body: { schoolId: a.json.id, validUntil: nairobi(7), lines: [{ variantId: book.id, quantity: 10, unitPrice: 41 }] } });
  const revIssued = await api('POST', `/school-supplier/quotes/${rev.json.id}/issue`, { token: owner });
  const q2After = (await api('GET', `/school-supplier/quotes/${q2.id}`, { token: owner })).json;
  check('issuing the revision replaces the original, which now reads as superseded', rev2.status === 200 && revIssued.json.status === 'ISSUED' && q2After.status === 'SUPERSEDED', [revIssued.json.status, q2After.status]);
  check('the school no longer sees the replaced one as open, and cannot accept it', (await api('POST', `/school-portal/quotes/${q2.id}/accept`, { token: tokenA, body: {} })).status === 409);

  // the supplier records an acceptance that came by phone or by LPO
  const q3 = (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [{ variantId: pen.id, quantity: 8 }] } })).json;
  await api('POST', `/school-supplier/quotes/${q3.id}/issue`, { token: owner });
  const byPhone = await api('POST', `/school-supplier/quotes/${q3.id}/accept`, { token: owner, body: { lpoNumber: 'LPO-PHONE' } });
  check('the supplier can record that the school accepted by phone: the order is made and it says the supplier recorded it', byPhone.status === 200 && byPhone.json.decidedBy === 'SUPPLIER' && byPhone.json.order?.orderNumber, byPhone.json);

  // running out
  const q4 = (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, validUntil: nairobi(-1), lines: [{ variantId: pen.id, quantity: 2 }] } })).json;
  check('a quotation that already ran out cannot be issued', (await api('POST', `/school-supplier/quotes/${q4.id}/issue`, { token: owner })).status === 400);
  const q5 = (await api('POST', '/school-supplier/quotes', { token: owner, body: { schoolId: a.json.id, lines: [{ variantId: pen.id, quantity: 2 }] } })).json;
  const q5i = (await api('POST', `/school-supplier/quotes/${q5.id}/issue`, { token: owner })).json;
  check('one with no date is open for 30 days from the day it is issued', q5i.validUntil === nairobi(30), q5i.validUntil);
  await sql.query('UPDATE school_quotes SET "validUntil" = $2::date WHERE id = $1', [q5.id, nairobi(-2)]);
  const listed = await api('GET', '/school-supplier/quotes?status=EXPIRED', { token: owner });
  check('once its date has passed it reads as expired', listed.json.some((q) => q.id === q5.id), listed.json.map?.((q) => q.status));
  const lateAccept = await api('POST', `/school-portal/quotes/${q5.id}/accept`, { token: tokenA, body: {} });
  check('an expired quotation cannot be accepted, and says so', lateAccept.status === 409 && /expired/.test(lateAccept.json.message), lateAccept.json);
  check('an expired quotation can be revised into a fresh draft', (await api('POST', `/school-supplier/quotes/${q5.id}/revise`, { token: owner })).status === 200);
  check('quotations can be listed by school and by status', (await api('GET', `/school-supplier/quotes?schoolId=${a.json.id}`, { token: owner })).json.length >= 5 && (await api('GET', `/school-supplier/quotes?schoolId=${b.json.id}`, { token: owner })).json.length === 0 && (await api('GET', '/school-supplier/quotes?status=ACCEPTED', { token: owner })).json.every((q) => q.status === 'ACCEPTED'));
  check('a quotation opens with the business letterhead, ready to print', (await api('GET', `/school-supplier/quotes/${q1.json.id}`, { token: owner })).json.business?.name === me.name);
  for (const t of ['school_quotes', 'school_quote_lines']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }

  section('15. Chasing what is owed, and choosing which invoices a payment pays');
  await receive(pen.id, 100, 10);
  const deliver15 = async (qty) => {
    const o = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: pen.id, quantity: qty }] } });
    await api('POST', `/school-supplier/orders/${o.json.id}/confirm`, { token: owner, body: {} });
    const d = await api('POST', `/school-supplier/orders/${o.json.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
    return d.json.deliveries[0].invoice;
  };
  const invD15 = await deliver15(3);
  const invE15 = await deliver15(2);
  const invF15 = await deliver15(1);
  await sql.query('UPDATE supplier_invoices SET "issueDate" = $3::date, "dueDate" = $2::date WHERE id = $1', [invD15.id, nairobi(-12), nairobi(-42)]);
  await sql.query('UPDATE supplier_invoices SET "issueDate" = $3::date, "dueDate" = $2::date WHERE id = $1', [invE15.id, nairobi(-40), nairobi(-70)]);
  const ou15 = (await api('GET', '/org-users', { token: owner })).json;
  const ownerOu15 = ou15.find((u) => u.role === 'OWNER');

  const od = await api('GET', '/school-supplier/overdue', { token: owner });
  const mine15 = od.json.rows.filter((r) => [invD15.id, invE15.id, invF15.id].includes(r.id));
  check('the overdue list holds the two late invoices, the longer overdue first, and not the one not yet due', od.status === 200 && mine15.length === 2 && mine15[0].id === invE15.id && mine15[1].id === invD15.id, mine15.map((r) => [r.invoiceNumber, r.daysLate]));
  check('it says how late each is and what it still owes (60 and 40 shillings of pens at 20)', mine15[0].daysLate === 40 && mine15[1].daysLate === 12 && mine15[0].balance === 40 && mine15[1].balance === 60, mine15);
  check('it carries the school and a total', Boolean(mine15[0].school.name) && od.json.totals.count >= 2 && od.json.totals.owed >= 100, od.json.totals);
  check('a school cannot see what is overdue', (await api('GET', '/school-supplier/overdue', { token: tokenA })).status === 401);

  const fu = await api('PATCH', `/school-supplier/invoices/${invD15.id}/follow-up`, { token: owner, body: { expectedPaymentDate: nairobi(-1), note: 'Bursar said cheque is being signed', responsibleId: ownerOu15.id } });
  check('a follow-up is saved: the date promised, a note and who is chasing', fu.status === 200 && fu.json.expectedPaymentDate === nairobi(-1) && fu.json.note === 'Bursar said cheque is being signed' && fu.json.responsibleId === ownerOu15.id, fu.json);
  const od2 = (await api('GET', '/school-supplier/overdue', { token: owner })).json.rows.find((r) => r.id === invD15.id);
  check('a promised date that has gone by is flagged as a broken promise', od2.promiseBroken === true && od2.expectedPaymentDate === nairobi(-1), od2);
  check('the invoice itself shows the follow-up', (await api('GET', `/school-supplier/invoices/${invD15.id}`, { token: owner })).json.followUpNote === 'Bursar said cheque is being signed');
  check('a dispute must say what it is about', (await api('PATCH', `/school-supplier/invoices/${invD15.id}/follow-up`, { token: owner, body: { disputed: true } })).status === 400);
  const disp = await api('PATCH', `/school-supplier/invoices/${invD15.id}/follow-up`, { token: owner, body: { disputed: true, disputeNote: 'They say 1 box was damaged' } });
  check('a dispute is recorded with its reason, and the earlier note is kept', disp.status === 200 && disp.json.disputed === true && disp.json.disputeNote === 'They say 1 box was damaged' && disp.json.note === 'Bursar said cheque is being signed', disp.json);
  const od3 = (await api('GET', '/school-supplier/overdue', { token: owner })).json;
  check('disputed invoices are counted apart in the totals', od3.totals.disputed >= 60 && od3.rows.find((r) => r.id === invD15.id).disputed === true, od3.totals);
  check('a promise dated before the invoice was issued is refused', (await api('PATCH', `/school-supplier/invoices/${invE15.id}/follow-up`, { token: owner, body: { expectedPaymentDate: '2020-01-01' } })).status === 400);
  check('someone who is not on the staff cannot be made responsible', (await api('PATCH', `/school-supplier/invoices/${invE15.id}/follow-up`, { token: owner, body: { responsibleId: '00000000-0000-4000-8000-000000000000' } })).status === 400);
  const cleared = await api('PATCH', `/school-supplier/invoices/${invD15.id}/follow-up`, { token: owner, body: { disputed: false, expectedPaymentDate: null, responsibleId: '' } });
  check('clearing the dispute, the date and the person works', cleared.status === 200 && cleared.json.disputed === false && cleared.json.disputeNote === null && cleared.json.expectedPaymentDate === null && cleared.json.responsibleId === null, cleared.json);
  check('a school cannot write follow-ups', (await api('PATCH', `/school-supplier/invoices/${invD15.id}/follow-up`, { token: tokenA, body: { note: 'x' } })).status === 401);
  check('every follow-up is in the audit log', (await sql.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'school.invoice_follow_up' AND "entityId" = $1`, [invD15.id])).rows[0].n >= 3);

  // choosing which invoices a payment pays
  const open15 = await api('GET', `/school-supplier/schools/${a.json.id}/open-invoices`, { token: owner });
  check('the invoices a school still owes are listed with their balances, oldest first', open15.status === 200 && [invD15, invE15, invF15].every((i) => open15.json.some((o) => o.id === i.id)) && open15.json.every((o) => o.balance > 0), open15.json.length);
  check('a school that does not exist is a 404, and a school cannot look', (await api('GET', '/school-supplier/schools/00000000-0000-4000-8000-000000000000/open-invoices', { token: owner })).status === 404 && (await api('GET', `/school-supplier/schools/${a.json.id}/open-invoices`, { token: tokenA })).status === 401);
  const pickE = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 40, method: 'CASH', allocations: [{ invoiceId: invE15.id, amount: 40 }] } });
  const eAfter = (await api('GET', `/school-supplier/invoices/${invE15.id}`, { token: owner })).json;
  const dAfter = (await api('GET', `/school-supplier/invoices/${invD15.id}`, { token: owner })).json;
  check('a payment set against a chosen invoice pays that one (not the oldest) and leaves the others owing', pickE.status === 201 && eAfter.status === 'PAID' && dAfter.status === 'ISSUED' && dAfter.balance === 60, [eAfter.status, dAfter.status]);
  check('a paid invoice drops out of the overdue list and cannot be followed up', !(await api('GET', '/school-supplier/overdue', { token: owner })).json.rows.some((r) => r.id === invE15.id) && (await api('PATCH', `/school-supplier/invoices/${invE15.id}/follow-up`, { token: owner, body: { note: 'x' } })).status === 409);
  check('paying more into an invoice than it owes is refused', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 100, method: 'CASH', allocations: [{ invoiceId: invD15.id, amount: 100 }] } })).status === 400);

  section('16. The LPO tick, and stock promised to other orders');
  const lpoOrder = (await api('POST', '/school-portal/orders', { token: tokenA, body: { lpoNumber: 'LPO-CHK-1', lines: [{ variantId: pen.id, quantity: 5 }] } })).json;
  const noLpoOrder = (await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: pen.id, quantity: 5 }] } })).json;
  check('a new order starts with its LPO not yet checked', lpoOrder.lpoVerifiedAt === null && lpoOrder.lpoVerifiedByName === null);
  const ticked = await api('POST', `/school-supplier/orders/${lpoOrder.id}/lpo-check`, { token: owner, body: { checked: true } });
  check('the LPO is ticked as received and checked, with who did it and when', ticked.status === 200 && Boolean(ticked.json.lpoVerifiedAt) && Boolean(ticked.json.lpoVerifiedByName), ticked.json);
  check('the tick can be taken off again', (await api('POST', `/school-supplier/orders/${lpoOrder.id}/lpo-check`, { token: owner, body: { checked: false } })).json.lpoVerifiedAt === null);
  check('an order with no LPO number has nothing to check', (await api('POST', `/school-supplier/orders/${noLpoOrder.id}/lpo-check`, { token: owner, body: { checked: true } })).status === 400);
  check('a school cannot tick its own LPO', (await api('POST', `/school-supplier/orders/${lpoOrder.id}/lpo-check`, { token: tokenA, body: { checked: true } })).status === 401);
  check('the tick needs yes or no', (await api('POST', `/school-supplier/orders/${lpoOrder.id}/lpo-check`, { token: owner, body: {} })).status === 400);
  await api('POST', `/school-supplier/orders/${lpoOrder.id}/lpo-check`, { token: owner, body: { checked: true } });
  check('it is on the order the supplier opens', (await api('GET', `/school-supplier/orders/${lpoOrder.id}`, { token: owner })).json.lpoVerifiedByName !== null);

  // what other confirmed orders are still waiting for
  await api('POST', `/school-supplier/orders/${lpoOrder.id}/confirm`, { token: owner, body: {} });
  const stockForNo = await api('GET', `/school-supplier/orders/${noLpoOrder.id}/stock?branchId=${branchId}`, { token: owner });
  const expectedReserved = Number((await sql.query(`SELECT coalesce(sum(greatest(0, coalesce(l."quantityConfirmed", l."quantityOrdered") - coalesce(l."quantityDelivered", 0))), 0) AS q FROM school_order_lines l JOIN school_orders o ON o.id = l."orderId" WHERE l."variantId" = $1 AND o.id <> $2 AND o.status IN ('CONFIRMED', 'PARTIALLY_DELIVERED')`, [pen.id, noLpoOrder.id])).rows[0].q);
  const noLine = stockForNo.json.lines[0];
  check('the stock view says how many of the same product other confirmed orders are still waiting for', stockForNo.status === 200 && noLine.reserved === expectedReserved && expectedReserved >= 5, [noLine, expectedReserved]);
  const stockForLpo = await api('GET', `/school-supplier/orders/${lpoOrder.id}/stock?branchId=${branchId}`, { token: owner });
  const expectedOwn = Number((await sql.query(`SELECT coalesce(sum(greatest(0, coalesce(l."quantityConfirmed", l."quantityOrdered") - coalesce(l."quantityDelivered", 0))), 0) AS q FROM school_order_lines l JOIN school_orders o ON o.id = l."orderId" WHERE l."variantId" = $1 AND o.id <> $2 AND o.status IN ('CONFIRMED', 'PARTIALLY_DELIVERED')`, [pen.id, lpoOrder.id])).rows[0].q);
  check('an order is never counted against itself', stockForLpo.json.lines[0].reserved === expectedOwn && stockForLpo.json.lines[0].reserved === expectedReserved - 5, [stockForLpo.json.lines[0].reserved, expectedOwn, expectedReserved]);
  check('what is promised never goes below zero and does not change the stock figure', noLine.available === (await stockOf(pen.id)) && noLine.reserved >= 0);

  section('17. Tax withheld by the school, and its certificate');
  await receive(pen.id, 100, 10);
  const invW = await deliver15(10);
  check('an invoice of 200 (10 pens) to settle part in cash and part as tax withheld', invW.total === 200, invW);
  const cashW = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 194, method: 'CHEQUE', reference: 'CHQ-W1', allocations: [{ invoiceId: invW.id, amount: 194 }] } });
  check('the school pays 194 by cheque, keeping 6 back as tax', cashW.status === 201 && cashW.json.allocated === 194, cashW.json);
  check('tax withheld does not need a cheque number or bank', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 1, method: 'WITHHOLDING_TAX', allocations: [] } })).status === 201);
  const whtW = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 6, method: 'WITHHOLDING_TAX', allocations: [{ invoiceId: invW.id, amount: 6 }], notes: '3% of 200' } });
  check('the 6 withheld is recorded as a payment of its own kind and settles the invoice', whtW.status === 201 && whtW.json.method === 'WITHHOLDING_TAX' && whtW.json.certificateNumber === null && /^RC-/.test(whtW.json.receiptNumber), whtW.json);
  const invWAfter = (await api('GET', `/school-supplier/invoices/${invW.id}`, { token: owner })).json;
  check('together they pay the invoice in full', invWAfter.status === 'PAID' && invWAfter.amountPaid === 200 && invWAfter.balance === 0, invWAfter);
  check('the invoice lists both receipts', invWAfter.payments.length === 2 && invWAfter.payments.some((p) => p.method === 'WITHHOLDING_TAX'), invWAfter.payments);
  check('tax withheld cannot bounce', (await api('POST', `/school-supplier/payments/${whtW.json.id}/bounce`, { token: owner, body: { reason: 'it came back' } })).status === 400);
  check('a certificate only goes with tax withheld', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 5, method: 'CASH', certificateNumber: 'X1' } })).status === 400);

  const st17 = (await api('GET', `/school-supplier/schools/${a.json.id}/statement`, { token: owner })).json;
  check('the statement says the 6 was tax withheld', st17.entries.some((e) => e.reference === whtW.json.receiptNumber && e.credit === 6 && /Tax withheld/.test(e.description)), st17.entries.slice(-3));

  const sum0 = await api('GET', '/school-supplier/withholding', { token: owner });
  const row0 = sum0.json.rows.find((r) => r.id === whtW.json.id);
  check('the withholding list shows it waiting for its certificate, with what was withheld in all', sum0.status === 200 && row0.certificate === 'WAITING' && row0.amount === 6 && sum0.json.totals.withheld >= 7 && sum0.json.totals.withoutCertificate >= 7, sum0.json.totals);
  check('a school cannot see it', (await api('GET', '/school-supplier/withholding', { token: tokenA })).status === 401);
  const cert = await api('PATCH', `/school-supplier/payments/${whtW.json.id}/certificate`, { token: owner, body: { certificateNumber: 'WHT-2026-0457' } });
  check('the certificate number is recorded with the day it came', cert.status === 200 && cert.json.certificateNumber === 'WHT-2026-0457' && cert.json.certificateReceivedOn === nairobi(), cert.json);
  const sum1 = (await api('GET', '/school-supplier/withholding', { token: owner })).json;
  check('it then counts as covered by a certificate', sum1.rows.find((r) => r.id === whtW.json.id).certificate === 'RECEIVED' && sum1.totals.withCertificate >= 6, sum1.totals);
  check('the receipt now carries the certificate', (await api('GET', `/school-supplier/payments/${whtW.json.id}`, { token: owner })).json.certificateNumber === 'WHT-2026-0457');
  check('a certificate cannot be put on a cash payment', (await api('PATCH', `/school-supplier/payments/${cashW.json.id}/certificate`, { token: owner, body: { certificateNumber: 'NOPE-1' } })).status === 400);
  check('a certificate cannot be dated before the tax was withheld', (await api('PATCH', `/school-supplier/payments/${whtW.json.id}/certificate`, { token: owner, body: { certificateNumber: 'WHT-2026-0457', receivedOn: nairobi(-5) } })).status === 400);
  check('a certificate needs a number', (await api('PATCH', `/school-supplier/payments/${whtW.json.id}/certificate`, { token: owner, body: {} })).status === 400);

  // one withheld long ago and still no certificate
  const oldWht = (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 1, method: 'WITHHOLDING_TAX', allocations: [] } })).json;
  await sql.query('UPDATE supplier_payments SET "receivedOn" = $2::date WHERE id = $1', [oldWht.id, nairobi(-45)]);
  const sum2 = (await api('GET', '/school-supplier/withholding', { token: owner })).json;
  check('tax withheld more than 30 days ago with no certificate is flagged missing', sum2.rows.find((r) => r.id === oldWht.id).certificate === 'MISSING' && sum2.rows.find((r) => r.id === oldWht.id).daysWaiting >= 45, sum2.rows.find((r) => r.id === oldWht.id));
  const ranged = (await api('GET', `/school-supplier/withholding?from=${nairobi(-10)}&to=${nairobi()}`, { token: owner })).json;
  check('the list can be limited to a period', !ranged.rows.some((r) => r.id === oldWht.id) && ranged.rows.some((r) => r.id === whtW.json.id), ranged.rows.length);
  check('by school totals add up to the total', Math.abs(sum2.totals.bySchool.reduce((s, x) => s + x.withheld, 0) - sum2.totals.withheld) < 0.01);

  section('18. Tenders, compliance documents and contracts');
  await sql.query('DELETE FROM school_compliance_docs WHERE "organizationId" = $1', [orgId]);
  await receive(pen.id, 200, 10);
  const tNo = `TND-${tag}`;
  check('a school cannot see or make tenders', (await api('GET', '/school-supplier/tenders', { token: tokenA })).status === 401 && (await api('POST', '/school-supplier/tenders', { token: tokenA, body: { entityName: 'X', tenderNumber: 'Y', title: 'Z' } })).status === 401);

  // compliance documents
  const docOld = await api('POST', '/school-supplier/compliance', { token: owner, body: { name: `Tax compliance certificate ${tag}`, reference: 'TCC-1', issuedOn: nairobi(-400), expiryDate: nairobi(-3) } });
  check('a compliance document that has run out is listed as expired', docOld.status === 201 && docOld.json.state === 'EXPIRED', docOld.json);
  const docOk = await api('POST', '/school-supplier/compliance', { token: owner, body: { name: `Business permit ${tag}`, expiryDate: nairobi(200) } });
  check('one with a long time left is fine; one due in under 30 days is "expiring"', docOk.json.state === 'OK' && (await api('POST', '/school-supplier/compliance', { token: owner, body: { name: `Insurance ${tag}`, expiryDate: nairobi(10) } })).json.state === 'EXPIRING');
  check('a document cannot expire before it was issued', (await api('POST', '/school-supplier/compliance', { token: owner, body: { name: 'Bad doc', issuedOn: nairobi(), expiryDate: nairobi(-1) } })).status === 400);

  // a tender
  const tender = await api('POST', '/school-supplier/tenders', { token: owner, body: { entityName: 'County Education Office', tenderNumber: tNo, title: 'Supply of stationery 2027', closingDate: nairobi(20), notes: 'Lot 2' } });
  check('a tender is registered with the standard checklist', tender.status === 201 && tender.json.status === 'IDENTIFIED' && tender.json.checklist.length === 7 && tender.json.checklist.every((c) => c.done === false), tender.json);
  check('the same tender number cannot be registered twice', (await api('POST', '/school-supplier/tenders', { token: owner, body: { entityName: 'Another', tenderNumber: tNo, title: 'x y' } })).status === 409);
  const tid = tender.json.id;
  const upd = await api('PUT', `/school-supplier/tenders/${tid}`, { token: owner, body: { entityName: 'County Education Office', tenderNumber: tNo, title: 'Supply of stationery 2027 (Lot 2)', closingDate: nairobi(20) } });
  check('its details can be changed', upd.status === 200 && upd.json.title.includes('Lot 2'), upd.json);

  // the bid
  const bid = await api('PUT', `/school-supplier/tenders/${tid}/lines`, { token: owner, body: { lines: [{ variantId: book.id, description: 'Exercise book 96pg', quantity: 1000, unitCost: 30, unitPrice: 45 }, { variantId: pen.id, description: 'Blue pen', quantity: 500, unitCost: 10, unitPrice: 20 }, { description: 'Delivery to 12 schools', quantity: 1, unitCost: 4000, unitPrice: 5000, taxRate: 0 }] } });
  check('the bid is costed: cost 39,000, priced 60,000, margin 21,000 (35%)', bid.status === 200 && bid.json.bid.cost === 39000 && bid.json.bid.subtotal === 60000 && bid.json.bid.margin === 21000 && bid.json.bid.marginPercent === 35, bid.json.bid);
  check('VAT is taken from the product unless a rate is given: total is the price plus VAT', bid.json.bid.total === bid.json.bid.subtotal + bid.json.bid.taxAmount, bid.json.bid);
  check('a product that does not exist cannot be on the bid', (await api('PUT', `/school-supplier/tenders/${tid}/lines`, { token: owner, body: { lines: [{ variantId: '00000000-0000-4000-8000-000000000000', description: 'x', quantity: 1, unitCost: 1, unitPrice: 2 }] } })).status === 400);
  const bidTotal = bid.json.bid.total;

  // the checklist
  const started = await api('POST', `/school-supplier/tenders/${tid}/start`, { token: owner });
  check('work starts: the tender is being prepared', started.status === 200 && started.json.status === 'PREPARING');
  const added = await api('POST', `/school-supplier/tenders/${tid}/checklist`, { token: owner, body: { title: 'Sample products delivered' } });
  check('an item can be added to the checklist', added.status === 201 && added.json.checklist.length === 8, added.status);
  const ready0 = await api('GET', `/school-supplier/tenders/${tid}/readiness`, { token: owner });
  check('it is not ready: the unticked items and the expired certificate are named', ready0.json.blockers.length >= 2 && ready0.json.blockers.some((b) => b.includes('Not ready on the checklist')) && ready0.json.blockers.some((b) => b.includes(`Tax compliance certificate ${tag}`)), ready0.json);
  const refuse = await api('POST', `/school-supplier/tenders/${tid}/submit`, { token: owner, body: {} });
  check('submitting is refused, saying why and that the owner can override', refuse.status === 400 && /override|anyway|reason/i.test(refuse.json.message), refuse.json);
  check('an override reason that is too short is refused', (await api('POST', `/school-supplier/tenders/${tid}/submit`, { token: owner, body: { overrideReason: 'ok' } })).status === 400);
  for (const c of added.json.checklist) await api('PATCH', `/school-supplier/tenders/${tid}/checklist/${c.id}`, { token: owner, body: { done: true } });
  const ready1 = await api('GET', `/school-supplier/tenders/${tid}/readiness`, { token: owner });
  check('with every item ticked what is left in the way is the expired certificate and the insurance that runs out before the tender closes', ready1.json.blockers.length === 2 && ready1.json.blockers.some((b) => b.includes('expired')) && ready1.json.blockers.some((b) => b.includes('before the tender closes')), ready1.json.blockers);
  const sub = await api('POST', `/school-supplier/tenders/${tid}/submit`, { token: owner, body: { overrideReason: 'The new certificate was applied for and is due this week' } });
  check('the owner submits anyway with a reason, and the reason is kept', sub.status === 200 && sub.json.status === 'SUBMITTED' && sub.json.submittedOn === nairobi() && sub.json.submitOverride.includes('applied for'), sub.json);
  check('the override is in the audit log', (await sql.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'school.tender_submitted_override' AND "entityId" = $1`, [tid])).rows[0].n === 1);
  check('a submitted tender cannot be changed or deleted', (await api('PUT', `/school-supplier/tenders/${tid}`, { token: owner, body: { entityName: 'x y', tenderNumber: tNo, title: 'changed' } })).status === 409 && (await api('DELETE', `/school-supplier/tenders/${tid}`, { token: owner })).status === 409 && (await api('PUT', `/school-supplier/tenders/${tid}/lines`, { token: owner, body: { lines: [] } })).status === 409);

  // a tender that has closed cannot be submitted
  const late = (await api('POST', '/school-supplier/tenders', { token: owner, body: { entityName: 'Old Office', tenderNumber: `${tNo}-L`, title: 'Late one', closingDate: nairobi(5) } })).json;
  await sql.query('UPDATE school_tenders SET "closingDate" = $2::date WHERE id = $1', [late.id, nairobi(-1)]);
  check('a tender past its closing date cannot be submitted, even by the owner', (await api('POST', `/school-supplier/tenders/${late.id}/submit`, { token: owner, body: { overrideReason: 'Please let it through' } })).status === 400);
  check('an unsubmitted tender can be withdrawn, and then it is finished', (await api('POST', `/school-supplier/tenders/${late.id}/withdraw`, { token: owner, body: { note: 'Missed the deadline' } })).json.status === 'WITHDRAWN' && (await api('POST', `/school-supplier/tenders/${late.id}/lost`, { token: owner, body: {} })).status === 409);

  // winning
  const noSchool = await api('POST', `/school-supplier/tenders/${tid}/award`, { token: owner, body: { startDate: nairobi(), endDate: nairobi(365) } });
  check('winning needs a school for the contract when the tender named none', noSchool.status === 400 && /school/i.test(noSchool.json.message), noSchool.json);
  check('a contract cannot end before it starts', (await api('POST', `/school-supplier/tenders/${tid}/award`, { token: owner, body: { schoolId: a.json.id, startDate: nairobi(10), endDate: nairobi(1) } })).status === 400);
  const won = await api('POST', `/school-supplier/tenders/${tid}/award`, { token: owner, body: { schoolId: a.json.id, startDate: nairobi(-1), endDate: nairobi(365) } });
  check('winning makes a contract numbered CT-, at the bid amount, and marks the tender won', won.status === 200 && won.json.tender.status === 'WON' && /^CT-\d{4}-\d{4}$/.test(won.json.contractNumber) && won.json.tender.contract?.contractNumber === won.json.contractNumber, won.json);
  check('it cannot be awarded twice', (await api('POST', `/school-supplier/tenders/${tid}/award`, { token: owner, body: { schoolId: a.json.id, startDate: nairobi(), endDate: nairobi(30) } })).status === 409);
  const cid = won.json.contractId;
  const c0 = (await api('GET', `/school-supplier/contracts/${cid}`, { token: owner })).json;
  check('the contract is worth the bid, with its tender, nothing invoiced yet', c0.value === bidTotal && c0.originalValue === bidTotal && c0.tender?.tenderNumber === tNo && c0.netInvoiced === 0 && c0.remaining === bidTotal && c0.status === 'ACTIVE' && c0.daysLeft >= 364, c0);

  // orders under the contract
  const orderUnder = async (qty, over = {}) => {
    const o = await api('POST', '/school-portal/orders', { token: tokenA, body: { lines: [{ variantId: pen.id, quantity: qty }] } });
    await api('POST', `/school-supplier/orders/${o.json.id}/confirm`, { token: owner, body: {} });
    return o.json;
  };
  const oc1 = await orderUnder(10);
  check('the school\'s order goes under its only running contract by itself', oc1.contract?.id === cid && oc1.contract.contractNumber === won.json.contractNumber, oc1.contract);
  const dl = await api('POST', `/school-supplier/orders/${oc1.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
  const invUnder = dl.json.deliveries[0].invoice;
  const c1 = (await api('GET', `/school-supplier/contracts/${cid}`, { token: owner })).json;
  check('delivering invoices it against the contract: 200 used, the rest left, 200 owed', invUnder.total === 200 && c1.netInvoiced === 200 && c1.remaining === bidTotal - 200 && c1.owed === 200 && c1.invoices.length === 1 && c1.orders.length === 1, c1);
  check('the contract shows the profit on it: sales 200 less cost 100 = 100 (50%)', c1.profit === 100 && c1.profitPercent === 50, [c1.profit, c1.profitPercent]);
  const cnC = await api('POST', '/school-supplier/credit-notes', { token: owner, body: { invoiceId: invUnder.id, reason: 'RETURNED', lines: [{ invoiceLineId: (await api('GET', `/school-supplier/invoices/${invUnder.id}/creditable`, { token: owner })).json.lines[0].invoiceLineId, quantity: 4 }] } });
  const c2 = (await api('GET', `/school-supplier/contracts/${cid}`, { token: owner })).json;
  check('a credit note against that invoice comes off what the contract has used (80)', cnC.status === 201 && c2.netInvoiced === 120 && c2.remaining === bidTotal - 120, [c2.netInvoiced, c2.remaining]);
  const cpay = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 120, method: 'CASH', allocations: [{ invoiceId: invUnder.id, amount: 120 }] } });
  check('payments show against the contract: nothing owed once the 120 is paid', cpay.status === 201 && (await api('GET', `/school-supplier/contracts/${cid}`, { token: owner })).json.owed === 0);

  // variations
  const v1 = await api('POST', `/school-supplier/contracts/${cid}/variations`, { token: owner, body: { amount: 10000, reason: 'Extra 12 schools added' } });
  check('a variation adds to the value and is listed with its reason', v1.status === 201 && v1.json.value === bidTotal + 10000 && v1.json.variations.length === 1 && v1.json.variations[0].reason === 'Extra 12 schools added', v1.json.value);
  check('a variation that takes the value to nothing is refused', (await api('POST', `/school-supplier/contracts/${cid}/variations`, { token: owner, body: { amount: -(bidTotal + 10000), reason: 'cancel everything' } })).status === 400);
  check('a variation of nothing, or with no reason, is refused', (await api('POST', `/school-supplier/contracts/${cid}/variations`, { token: owner, body: { amount: 0, reason: 'nothing at all' } })).status === 400 && (await api('POST', `/school-supplier/contracts/${cid}/variations`, { token: owner, body: { amount: 5 } })).status === 400);

  // moving orders between contracts
  const small = await api('POST', '/school-supplier/contracts', { token: owner, body: { schoolId: a.json.id, title: 'Small top-up contract', startDate: nairobi(-1), endDate: nairobi(30), value: 100 } });
  check('a second contract is made directly, with no tender', small.status === 201 && small.json.status === 'ACTIVE' && small.json.tender === null && /^CT-/.test(small.json.contractNumber), small.json);
  const oc2 = await orderUnder(2);
  check('with two running contracts a new order is not put under either by itself', oc2.contract === null, oc2.contract);
  const lk = await api('POST', `/school-supplier/orders/${oc2.id}/contract`, { token: owner, body: { contractId: small.json.id } });
  check('the supplier puts it under the small one', lk.status === 200 && (await api('GET', `/school-supplier/orders/${oc2.id}`, { token: owner })).json.contract?.id === small.json.id);
  check('a contract with another school is refused', (await api('POST', `/school-supplier/orders/${oc2.id}/contract`, { token: owner, body: { contractId: (await api('POST', '/school-supplier/contracts', { token: owner, body: { schoolId: b.json.id, title: 'Other school', startDate: nairobi(), endDate: nairobi(10), value: 500 } })).json.id } })).status === 400);
  check('it can be taken off again, and put back', (await api('POST', `/school-supplier/orders/${oc2.id}/contract`, { token: owner, body: { contractId: null } })).status === 200 && (await api('POST', `/school-supplier/orders/${oc2.id}/contract`, { token: owner, body: { contractId: small.json.id } })).status === 200);
  const oc3 = await orderUnder(10);
  await api('POST', `/school-supplier/orders/${oc3.id}/contract`, { token: owner, body: { contractId: small.json.id } });
  await api('POST', `/school-supplier/orders/${oc2.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
  await api('POST', `/school-supplier/orders/${oc3.id}/deliver`, { token: owner, body: { branchId, receivedByName: 'Mr Otieno' } });
  const cs = (await api('GET', `/school-supplier/contracts/${small.json.id}`, { token: owner })).json;
  check('invoicing beyond the contract value is allowed but shown: 240 invoiced on a 100 contract is 140 over', cs.netInvoiced === 240 && cs.overrun === 140 && cs.remaining === 0, [cs.netInvoiced, cs.overrun]);

  // closing
  const contractClosed18 = await api('POST', `/school-supplier/contracts/${small.json.id}/close`, { token: owner, body: { outcome: 'COMPLETED', note: 'All delivered' } });
  check('a contract can be closed as completed, with a note', contractClosed18.status === 200 && contractClosed18.json.status === 'COMPLETED' && contractClosed18.json.closedNote === 'All delivered' && contractClosed18.json.daysLeft === null, contractClosed18.json);
  check('a closed contract cannot be varied, changed, closed again or have orders put under it', (await api('POST', `/school-supplier/contracts/${small.json.id}/variations`, { token: owner, body: { amount: 10, reason: 'too late now' } })).status === 409 && (await api('PATCH', `/school-supplier/contracts/${small.json.id}`, { token: owner, body: { title: 'New name' } })).status === 409 && (await api('POST', `/school-supplier/contracts/${small.json.id}/close`, { token: owner, body: { outcome: 'TERMINATED', note: 'again' } })).status === 409 && (await api('POST', `/school-supplier/orders/${(await orderUnder(1)).id}/contract`, { token: owner, body: { contractId: small.json.id } })).status === 409);
  check('contracts can be listed by status and school', (await api('GET', '/school-supplier/contracts?status=ACTIVE', { token: owner })).json.every((c) => c.status === 'ACTIVE') && (await api('GET', `/school-supplier/contracts?schoolId=${a.json.id}`, { token: owner })).json.length >= 2);
  check('a school\'s running contracts can be listed for choosing one on an order', (await api('GET', `/school-supplier/schools/${a.json.id}/running-contracts`, { token: owner })).json.some((c) => c.id === cid));

  // a lost tender
  const t2 = (await api('POST', '/school-supplier/tenders', { token: owner, body: { entityName: 'Ministry', tenderNumber: `${tNo}-2`, title: 'Another bid' } })).json;
  check('a tender cannot be marked lost before it was submitted', (await api('POST', `/school-supplier/tenders/${t2.id}/lost`, { token: owner, body: {} })).status === 409);
  check('tenders can be listed by status', (await api('GET', '/school-supplier/tenders?status=WON', { token: owner })).json.some((t) => t.id === tid) && (await api('GET', '/school-supplier/tenders', { token: owner })).json.length >= 3);
  const doc = (await api('GET', '/school-supplier/compliance', { token: owner })).json;
  check('compliance documents can be changed and removed', (await api('PUT', `/school-supplier/compliance/${docOld.json.id}`, { token: owner, body: { name: `Tax compliance certificate ${tag}`, reference: 'TCC-2', expiryDate: nairobi(300) } })).json.state === 'OK' && (await api('DELETE', `/school-supplier/compliance/${docOk.json.id}`, { token: owner })).status === 200 && doc.length >= 3);
  for (const t of ['school_tenders', 'school_tender_checks', 'school_tender_lines', 'school_compliance_docs', 'school_contracts', 'school_contract_variations']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }

  section('19. Retention held back by the school');
  const setRet = (percent, days) => api('PATCH', `/school-supplier/schools/${a.json.id}`, { token: owner, body: { retentionPercent: percent, retentionReleaseDays: days } });
  const r19 = await setRet(10, 30);
  check('a school can be given a usual retention of 10% released after 30 days', r19.status === 200 && r19.json.retentionPercent === 10 && r19.json.retentionReleaseDays === 30, r19.json);
  check('retention above 50% is refused', (await setRet(60, 30)).status === 400);
  await receive(pen.id, 100, 10);
  const invR = await deliver15(10);
  const invR1 = (await api('GET', `/school-supplier/invoices/${invR.id}`, { token: owner })).json;
  check('delivering makes an invoice of 200 with 20 held back, so only 180 is due', invR1.total === 200 && invR1.retentionAmount === 20 && invR1.retentionHeld === 20 && invR1.balance === 180, invR1);
  check('the release date is 30 days away', invR1.retentionReleaseDate === nairobi(30), invR1.retentionReleaseDate);
  check('paying more than is due now is refused (the retention is not due)', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 181, method: 'CASH', allocations: [{ invoiceId: invR.id, amount: 181 }] } })).status === 400);
  const payR = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 180, method: 'CASH', allocations: [{ invoiceId: invR.id, amount: 180 }] } });
  const invR2 = (await api('GET', `/school-supplier/invoices/${invR.id}`, { token: owner })).json;
  check('paying the 180 leaves nothing due, with the 20 still held', payR.status === 201 && invR2.balance === 0 && invR2.retentionHeld === 20 && invR2.status !== 'PAID', invR2);
  const ret0 = (await api('GET', '/school-supplier/retention', { token: owner })).json;
  const rr0 = ret0.rows.find((r) => r.invoiceId === invR.id);
  check('the retention list shows it as held, with its HELD event', rr0 && rr0.held === 20 && rr0.state === 'HELD' && rr0.events[0].kind === 'HELD' && ret0.totals.held >= 20, rr0);
  check('what is held is not counted as overdue', !JSON.stringify((await api('GET', '/school-supplier/overdue', { token: owner })).json).includes(invR.invoiceNumber));
  check('a school cannot see the supplier\'s retention list', (await api('GET', '/school-supplier/retention', { token: tokenA })).status === 401);

  check('a dispute needs its reason', (await api('PATCH', `/school-supplier/retention/${invR.id}`, { token: owner, body: { disputed: true } })).status === 400);
  const dis = await api('PATCH', `/school-supplier/retention/${invR.id}`, { token: owner, body: { disputed: true, disputeNote: 'Defects list not cleared' } });
  check('a dispute is recorded and shown', dis.status === 200 && dis.json.state === 'DISPUTED' && dis.json.disputeNote === 'Defects list not cleared', dis.json);
  const undis = await api('PATCH', `/school-supplier/retention/${invR.id}`, { token: owner, body: { disputed: false, expectedReleaseDate: nairobi(-1) } });
  check('with the dispute cleared and the date passed, it is due for release and one day late', undis.status === 200 && undis.json.state === 'DUE_FOR_RELEASE' && undis.json.daysLate === 1, undis.json);

  check('another school cannot raise it', (await api('POST', `/school-portal/invoices/${invR.id}/retention-request`, { token: tokenB, body: {} })).status === 404);
  const req = await api('POST', `/school-portal/invoices/${invR.id}/retention-request`, { token: tokenA, body: { note: 'Please release' } });
  check('the school can raise it and the supplier sees the request', req.status === 200 && req.json.requestedAt && req.json.events.some((e) => e.kind === 'RELEASE_REQUESTED'), req.json);
  check('the supplier can record that it asked', (await api('POST', `/school-supplier/retention/${invR.id}/requested`, { token: owner, body: {} })).status === 200);

  check('releasing more than is held is refused', (await api('POST', `/school-supplier/retention/${invR.id}/release`, { token: owner, body: { amount: 50 } })).status === 400);
  const rel1 = await api('POST', `/school-supplier/retention/${invR.id}/release`, { token: owner, body: { amount: 5 } });
  const invR3 = (await api('GET', `/school-supplier/invoices/${invR.id}`, { token: owner })).json;
  check('releasing 5 leaves 15 held and 5 due now', rel1.status === 200 && rel1.json.held === 15 && rel1.json.released === 5 && invR3.balance === 5 && invR3.retentionHeld === 15, invR3);
  check('the school can then pay the 5', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 5, method: 'CASH', allocations: [{ invoiceId: invR.id, amount: 5 }] } })).status === 201);
  const rel2 = await api('POST', `/school-supplier/retention/${invR.id}/release`, { token: owner, body: {} });
  check('releasing the rest leaves nothing held, with HELD and RELEASED events kept', rel2.status === 200 && rel2.json.held === 0 && rel2.json.state === 'RELEASED' && rel2.json.events.filter((e) => e.kind === 'RELEASED').length === 2, rel2.json);
  check('the school pays the final 15 and the invoice is paid', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 15, method: 'CASH', allocations: [{ invoiceId: invR.id, amount: 15 }] } })).status === 201 && (await api('GET', `/school-supplier/invoices/${invR.id}`, { token: owner })).json.status === 'PAID');
  check('an invoice without retention cannot be released', (await api('POST', `/school-supplier/retention/${invW.id}/release`, { token: owner, body: {} })).status === 404);

  const kR = await api('POST', '/school-supplier/contracts', { token: owner, body: { schoolId: a.json.id, title: `Retention contract ${tag}`, startDate: nairobi(-1), endDate: nairobi(200), value: 100000, retentionPercent: 5, retentionReleaseDays: 90 } });
  check('a contract can carry its own retention terms', kR.status === 201 && kR.json.retentionPercent === 5 && kR.json.retentionReleaseDays === 90, kR.json);
  await setRet(0, 0);
  const rls19 = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'supplier_retention_events'`)).rows[0];
  check('supplier_retention_events has row-level security switched on and forced', rls19?.on === true && rls19?.forced === true, rls19);

  section('20. Bad debts: the provision, write-offs, a second approver and putting one back');
  const mgrEmail = `mgr${tag.toLowerCase()}@test.local`;
  const mgrMake = await api('POST', '/org-users', { token: owner, body: { email: mgrEmail, fullName: 'Second Approver', password: 'password123', role: 'MANAGER', branchId } });
  check('a manager can be added to be the second approver', mgrMake.status === 201, mgrMake.json);
  const mgr = (await api('POST', '/auth/login', { body: { email: mgrEmail, password: 'password123' } })).json.accessToken;
  const rates = { rate1To30: 1, rate31To60: 5, rate61To90: 20, rate91To180: 50, rateOver180: 100, approvalThreshold: 100 };
  check('a manager cannot change the bad-debt rules', (await api('PUT', '/school-supplier/bad-debts/settings', { token: mgr, body: rates })).status === 403);
  check('a rate for an older debt below a newer one is refused', (await api('PUT', '/school-supplier/bad-debts/settings', { token: owner, body: { ...rates, rate61To90: 2 } })).status === 400);
  check('a rate above 100 is refused', (await api('PUT', '/school-supplier/bad-debts/settings', { token: owner, body: { ...rates, rateOver180: 150 } })).status === 400);
  const setBd = await api('PUT', '/school-supplier/bad-debts/settings', { token: owner, body: rates });
  check('the owner sets the rates and a threshold of 100 for needing a second person', setBd.status === 200 && setBd.json.settings.approvalThreshold === 100 && setBd.json.settings.rates.D91_180 === 50, setBd.json);
  check('a school cannot see the bad-debt figures', (await api('GET', '/school-supplier/bad-debts', { token: tokenA })).status === 401);

  const bd0 = (await api('GET', '/school-supplier/bad-debts', { token: owner })).json;
  const profit0 = (await api('GET', `/reports/profit?from=${nairobi()}&to=${nairobi()}`, { token: owner })).json.totals.badDebts;
  await receive(pen.id, 100, 10);
  const invP1 = await deliver15(10); // 200, 20 days late
  const invP2 = await deliver15(5); // 100, 100 days late
  const invP3 = await deliver15(2); // 40, not due yet
  await sql.query('UPDATE supplier_invoices SET "issueDate" = $3::date, "dueDate" = $2::date WHERE id = $1', [invP1.id, nairobi(-20), nairobi(-50)]);
  await sql.query('UPDATE supplier_invoices SET "issueDate" = $3::date, "dueDate" = $2::date WHERE id = $1', [invP2.id, nairobi(-100), nairobi(-130)]);
  const bd1 = (await api('GET', '/school-supplier/bad-debts', { token: owner })).json;
  const band = (b, k) => b.provision.byBand.find((x) => x.band === k);
  check('the provision grows by 1% of the 200 (20 days late) and 50% of the 100 (100 days late)', Math.abs(band(bd1, 'D1_30').provision - band(bd0, 'D1_30').provision - 2) < 0.01 && Math.abs(band(bd1, 'D91_180').provision - band(bd0, 'D91_180').provision - 50) < 0.01 && Math.abs(bd1.provision.total - bd0.provision.total - 52) < 0.01 && Math.abs(bd1.provision.overdue - bd0.provision.overdue - 300) < 0.01, [bd0.provision.total, bd1.provision.total]);
  check('the school appears with what it owes late and its share', bd1.provision.bySchool.some((s) => s.schoolId === a.json.id && s.provision >= 52), bd1.provision.bySchool);
  const post1 = await api('POST', '/school-supplier/bad-debts/provision', { token: owner, body: { note: 'Month end' } });
  check('the provision can be recorded as it stands', post1.status === 201 && Math.abs(post1.json.amount - bd1.provision.total) < 0.01 && post1.json.note === 'Month end', post1.json);
  const post2 = await api('POST', '/school-supplier/bad-debts/provision', { token: owner, body: {} });
  check('the next record remembers the one before it', post2.status === 201 && post2.json.previous === post1.json.amount, post2.json);
  check('the history lists them', (await api('GET', '/school-supplier/bad-debts', { token: owner })).json.history.length >= 2);

  const wo = (body, token = owner) => api('POST', '/school-supplier/write-offs', { token, body });
  check('a write-off needs a reason', (await wo({ invoiceId: invP3.id, amount: 10, reason: 'no' })).status === 400);
  check('a write-off cannot be more than is owed', (await wo({ invoiceId: invP3.id, amount: 999, reason: 'School has closed down' })).status === 400);
  const smallWo = await wo({ invoiceId: invP3.id, reason: 'School has closed down' });
  const invP3a = (await api('GET', `/school-supplier/invoices/${invP3.id}`, { token: owner })).json;
  check('a write-off under the threshold takes effect at once, closing the invoice', smallWo.status === 201 && smallWo.json.status === 'APPROVED' && invP3a.status === 'WRITTEN_OFF' && invP3a.balance === 0 && invP3a.writtenOffAmount === 40, [smallWo.json, invP3a.status]);
  check('nothing more can be paid on a written-off invoice', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 5, method: 'CASH', allocations: [{ invoiceId: invP3.id, amount: 5 }] } })).status === 400);
  check('a written-off invoice is out of the overdue list', !JSON.stringify((await api('GET', '/school-supplier/overdue', { token: owner })).json).includes(invP3.invoiceNumber));

  const big = await wo({ invoiceId: invP2.id, reason: 'School closed, no assets' });
  check('a write-off at the threshold waits for a second person and leaves the invoice alone', big.status === 201 && big.json.status === 'PENDING' && (await api('GET', `/school-supplier/invoices/${invP2.id}`, { token: owner })).json.balance === 100, big.json);
  check('another asking for the same invoice cannot go beyond what is owed', (await wo({ invoiceId: invP2.id, amount: 1, reason: 'Again please' })).status === 400);
  const noOverride = await api('POST', `/school-supplier/write-offs/${big.json.id}/approve`, { token: owner, body: {} });
  check('the owner cannot approve their own without saying why', noOverride.status === 403, noOverride.json);
  check('a short reason is not enough either', (await api('POST', `/school-supplier/write-offs/${big.json.id}/approve`, { token: owner, body: { overrideReason: 'ok' } })).status === 403);
  const self = await api('POST', `/school-supplier/write-offs/${big.json.id}/approve`, { token: owner, body: { overrideReason: 'Sole owner and the school has closed' } });
  const invP2a = (await api('GET', `/school-supplier/invoices/${invP2.id}`, { token: owner })).json;
  check('with the reason the owner can approve their own, and it is marked as an override', self.status === 200 && self.json.status === 'APPROVED' && self.json.overrideReason === 'Sole owner and the school has closed' && invP2a.status === 'WRITTEN_OFF' && invP2a.balance === 0, self.json);
  const aud = (await sql.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'school.writeoff_self_approved' AND "entityId" = $1`, [big.json.id])).rows[0].n;
  check('the override is in the audit log', aud === 1, aud);
  check('an approved write-off cannot be approved again', (await api('POST', `/school-supplier/write-offs/${big.json.id}/approve`, { token: owner, body: { overrideReason: 'Once more please' } })).status === 409);

  const part = await wo({ invoiceId: invP1.id, amount: 150, reason: 'Agreed to settle for 50' }, mgr);
  check('a manager asks to write off 150 of the 200', part.status === 201 && part.json.status === 'PENDING' && part.json.requestedByName === 'Second Approver', part.json);
  check('a manager cannot approve their own', (await api('POST', `/school-supplier/write-offs/${part.json.id}/approve`, { token: mgr, body: { overrideReason: 'I am the only one here' } })).status === 403);
  const okPart = await api('POST', `/school-supplier/write-offs/${part.json.id}/approve`, { token: owner, body: { note: 'Agreed' } });
  const invP1a = (await api('GET', `/school-supplier/invoices/${invP1.id}`, { token: owner })).json;
  check('the owner approves it as the second person: no override, 50 still owed, invoice still open', okPart.status === 200 && okPart.json.overrideReason === null && okPart.json.decidedByName !== 'Second Approver' && invP1a.balance === 50 && invP1a.writtenOffAmount === 150 && invP1a.status !== 'WRITTEN_OFF', [okPart.json, invP1a.balance, invP1a.status]);
  const payP1 = await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 50, method: 'CASH', allocations: [{ invoiceId: invP1.id, amount: 50 }] } });
  check('the school pays the 50 and the invoice is settled', payP1.status === 201 && (await api('GET', `/school-supplier/invoices/${invP1.id}`, { token: owner })).json.status === 'PAID');
  check('paying more than the 50 would have been refused', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 1, method: 'CASH', allocations: [{ invoiceId: invP1.id, amount: 1 }] } })).status === 400);

  const invP4 = await deliver15(5);
  const rej = await wo({ invoiceId: invP4.id, reason: 'Thinking of giving up' }, mgr);
  const rejected = await api('POST', `/school-supplier/write-offs/${rej.json.id}/reject`, { token: owner, body: { note: 'Chase it first' } });
  check('a write-off can be turned down, leaving the invoice as it was', rejected.status === 200 && rejected.json.status === 'REJECTED' && (await api('GET', `/school-supplier/invoices/${invP4.id}`, { token: owner })).json.balance === 100, rejected.json);
  check('a turned-down write-off cannot then be approved', (await api('POST', `/school-supplier/write-offs/${rej.json.id}/approve`, { token: owner, body: {} })).status === 409);

  check('a manager cannot put a write-off back', (await api('POST', `/school-supplier/write-offs/${big.json.id}/reverse`, { token: mgr, body: { reason: 'The school paid' } })).status === 403);
  check('putting one back needs a reason', (await api('POST', `/school-supplier/write-offs/${big.json.id}/reverse`, { token: owner, body: { reason: 'no' } })).status === 400);
  const putBack = await api('POST', `/school-supplier/write-offs/${big.json.id}/reverse`, { token: owner, body: { reason: 'The school found the money' } });
  const invP2b = (await api('GET', `/school-supplier/invoices/${invP2.id}`, { token: owner })).json;
  check('putting it back makes the 100 owed again and open for payment', putBack.status === 200 && putBack.json.status === 'REVERSED' && invP2b.balance === 100 && invP2b.writtenOffAmount === 0 && invP2b.status === 'ISSUED', [putBack.json, invP2b.status, invP2b.balance]);
  check('it cannot be put back twice', (await api('POST', `/school-supplier/write-offs/${big.json.id}/reverse`, { token: owner, body: { reason: 'Once more please' } })).status === 409);
  check('the school then pays it', (await api('POST', '/school-supplier/payments', { token: owner, body: { schoolId: a.json.id, amount: 100, method: 'CASH', allocations: [{ invoiceId: invP2.id, amount: 100 }] } })).status === 201 && (await api('GET', `/school-supplier/invoices/${invP2.id}`, { token: owner })).json.status === 'PAID');

  const list20 = (await api('GET', '/school-supplier/write-offs', { token: owner })).json;
  check('the write-offs list shows each with its status and who dealt with it', ['APPROVED', 'REVERSED', 'REJECTED'].every((st) => list20.some((w) => w.status === st)) && (await api('GET', '/school-supplier/write-offs?status=REJECTED', { token: owner })).json.every((w) => w.status === 'REJECTED'));
  const bd2 = (await api('GET', '/school-supplier/bad-debts', { token: owner })).json;
  check('the summary counts what has been written off', bd2.writtenOffToDate >= 190 && bd2.pendingWriteOffs === 0, [bd2.writtenOffToDate, bd2.pendingWriteOffs]);
  const profit1 = (await api('GET', `/reports/profit?from=${nairobi()}&to=${nairobi()}`, { token: owner })).json.totals.badDebts;
  check('the profit report takes off 40 + 100 + 150, less the 100 put back, so 190 more today', Math.abs(profit1 - profit0 - 190) < 0.01, [profit0, profit1]);
  for (const t of ['school_bad_debt_settings', 'school_write_offs', 'school_provision_entries']) {
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
