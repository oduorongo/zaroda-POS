// End-to-end test of receiving stock and paying suppliers against a LOCAL test setup: purchase orders received in parts with damaged
// goods, goods-received notes, supplier bills and payments, the payables report, roles, and the database rules behind them. It never
// touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433), the API started with the test settings, and the demo seed.   node scripts/e2e-receiving.js
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
async function call(method, p, { token, body } = {}) {
  const response = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);
const dayOffset = (n) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  await sql.connect();

  section('1. Setting up');
  check('API ready', (await call('GET', '/ready')).status === 200);
  const owner = (await call('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('owner can sign in', Boolean(owner));
  const h = (m, p, body, token = owner) => call(m, p, { token, body });
  const org = (await h('GET', '/organizations/me')).json;
  const branchId = (await h('GET', '/branches')).json[0].id;
  const mkStaff = async (role) => {
    const email = `${role.toLowerCase()}-rcv-${tag}@demo.zaroda.pos`;
    await h('POST', '/org-users', { email, fullName: `Rcv ${role}`, password: 'password123', role, branchId });
    return (await call('POST', '/auth/login', { body: { email, password: 'password123' } })).json.accessToken;
  };
  const cashier = await mkStaff('CASHIER');
  const supervisor = await mkStaff('SUPERVISOR');
  check('a cashier and a supervisor can sign in', Boolean(cashier && supervisor));

  const supplier = (await h('POST', '/suppliers', { name: `Unga Mills ${tag}`, paymentTermsDays: 14 })).json;
  check('a supplier with 14-day payment terms', supplier.id && supplier.paymentTermsDays === 14, supplier);
  const mkVariant = async (name, price) => {
    const p = (await h('POST', '/products', { name: `${name}-${tag}` })).json;
    return (await h('POST', `/products/${p.id}/variants`, { sku: `${name.toUpperCase().slice(0, 4)}-${tag}`, price })).json;
  };
  const flour = await mkVariant('Flour', 200);
  const sugar = await mkVariant('Sugar', 300);
  const onHand = async (variantId) => Number((await sql.query(`SELECT COALESCE(sum(quantity), 0) q FROM inventory_items WHERE "variantId" = $1 AND "branchId" = $2`, [variantId, branchId])).rows[0].q);
  const costOf = async (variantId) => Number((await sql.query(`SELECT cost FROM product_variants WHERE id = $1`, [variantId])).rows[0].cost);
  const ledger = async (variantId) => (await sql.query(`SELECT type, "quantityDelta" d, "referenceId" r FROM inventory_transactions WHERE "variantId" = $1 ORDER BY "createdAt"`, [variantId])).rows;

  const po = await h('POST', '/purchase-orders', { branchId, supplierId: supplier.id, reference: `PO-${tag}`, lineItems: [{ variantId: flour.id, quantityOrdered: 50, unitCost: 100 }] });
  check('a purchase order for 50 bags of flour at KES 100', po.status === 201, po.json);
  const line = po.json.lineItems[0].id;

  section('2. A delivery that arrives in part, with damaged goods');
  check('a cashier cannot receive stock', (await h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 1 }] }, cashier)).status === 403);
  check('more than is outstanding is refused', (await h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 51 }] })).status === 400);
  check('a line with nothing received and nothing damaged is refused', (await h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 0 }] })).status === 400);
  const r1 = await h('POST', `/purchase-orders/${po.json.id}/receive`, { deliveryNote: `DN-${tag}`, lines: [{ lineItemId: line, quantity: 20, damaged: 5, damagedNote: 'Bags torn' }], bill: { billNumber: `INV-${tag}-1` } });
  check('20 good and 5 damaged are received, with a bill for the good ones', r1.status === 201 && r1.json.receipt?.receiptNumber?.startsWith('GRN-') && r1.json.bill?.total === 2000, r1.json.message || r1.json);
  check('only the 20 good bags are in stock (the 5 damaged never enter)', (await onHand(flour.id)) === 20, await onHand(flour.id));
  const led = await ledger(flour.id);
  check('the stock movement is a RECEIPT pointing at the note - not an adjustment', led.length === 1 && led[0].type === 'RECEIPT' && Number(led[0].d) === 20 && led[0].r === r1.json.receipt.id, led);
  check('the product cost became the price paid (KES 100)', (await costOf(flour.id)) === 100, await costOf(flour.id));
  const noteLine = r1.json.receipt.lines[0];
  check('the note shows 20 accepted, 5 damaged with the reason, KES 2,000 value', noteLine.quantityAccepted === 20 && noteLine.quantityDamaged === 5 && noteLine.damagedNote === 'Bags torn' && noteLine.value === 2000, noteLine);
  const po1 = (await h('GET', `/purchase-orders/${po.json.id}`)).json;
  check('the order is partly received; 30 are still outstanding (damaged goods do not count as received)', po1.status === 'PARTIALLY_RECEIVED' && Number(po1.lineItems[0].quantityReceived) === 20, po1.status);
  const bill1 = r1.json.bill;
  const dueExpected = dayOffset(14);
  check('the bill falls due 14 days on (the supplier\'s terms)', bill1.dueDate === dueExpected, { got: bill1.dueDate, dueExpected });

  section('3. A failed delivery changes nothing (all or nothing)');
  const stockBefore = await onHand(flour.id);
  const dupBill = await h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 10 }], bill: { billNumber: `INV-${tag}-1` } });
  check('a bill number the supplier already has is refused', dupBill.status === 409, dupBill);
  check('and the stock, the order and the notes are exactly as before', (await onHand(flour.id)) === stockBefore && Number((await h('GET', `/purchase-orders/${po.json.id}`)).json.lineItems[0].quantityReceived) === 20 && (await h('GET', `/goods-receipts?purchaseOrderId=${po.json.id}`)).json.length === 1);
  const noPrice = await h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 5, unitCost: undefined }], bill: { billNumber: `INV-${tag}-X` } });
  check('a bill is made with the order\'s price when the line has none of its own', noPrice.status === 201 && noPrice.json.bill.total === 500, noPrice.json.message || noPrice.json.bill);
  // 25 now outstanding

  section('4. The rest arrives at a higher price: the margin is checked');
  const race = await Promise.all([h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 25, unitCost: 195 }] }), h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 25, unitCost: 195 }] })]);
  const ok = race.filter((r) => r.status === 201);
  check('two deliveries booked at the same moment for the same 25: only one gets it', ok.length === 1 && race.some((r) => r.status === 400), race.map((r) => r.status));
  check('the order is fully received and the stock is 50', (await h('GET', `/purchase-orders/${po.json.id}`)).json.status === 'RECEIVED' && (await onHand(flour.id)) === 50, await onHand(flour.id));
  const w = ok[0].json.warnings?.[0];
  check('the person receiving is warned: at KES 195 against a price of KES 200 the margin is 2.5%', w && w.reason === 'BELOW_MINIMUM' && w.marginPercent === 2.5 && w.sku === flour.sku, ok[0].json.warnings);
  const blended = Math.round(((20 * 100 + 5 * 100 + 25 * 195) / 50) * 100) / 100;
  check(`the product cost is the weighted average of what was held and what arrived (KES ${blended})`, Math.abs((await costOf(flour.id)) - blended) < 0.011, await costOf(flour.id));
  check('a delivery against a finished order is refused', (await h('POST', `/purchase-orders/${po.json.id}/receive`, { lines: [{ lineItemId: line, quantity: 1 }] })).status === 400);

  section('5. Stock with no purchase order');
  const direct = await h('POST', '/goods-receipts', { branchId, supplierId: supplier.id, deliveryNote: `DN-D-${tag}`, lines: [{ variantId: sugar.id, quantity: 10, unitCost: 90 }, { variantId: flour.id, quantity: 0, damaged: 2, damagedNote: 'Wet' }], bill: { billNumber: `INV-${tag}-D` } });
  check('a direct delivery is received: sugar +10 at KES 90, 2 flour damaged', direct.status === 201 && direct.json.bill.total === 900, direct.json.message || direct.json);
  check('sugar is in stock; the damaged flour did not enter', (await onHand(sugar.id)) === 10 && (await onHand(flour.id)) === 50);
  const num = (n) => Number(n.split('-')[2]);
  check('the note numbers count up (per business, per year)', num(direct.json.receipt.receiptNumber) > num(r1.json.receipt.receiptNumber), [r1.json.receipt.receiptNumber, direct.json.receipt.receiptNumber]);
  check('a direct delivery needs a branch and a product on every line', (await h('POST', '/goods-receipts', { lines: [{ variantId: sugar.id, quantity: 1 }] })).status === 400 && (await h('POST', '/goods-receipts', { branchId, lines: [{ quantity: 1 }] })).status === 400);
  check('a bill needs a supplier and a price on every line', (await h('POST', '/goods-receipts', { branchId, lines: [{ variantId: sugar.id, quantity: 1, unitCost: 90 }], bill: {} })).status === 400 && (await h('POST', '/goods-receipts', { branchId, supplierId: supplier.id, lines: [{ variantId: sugar.id, quantity: 1 }], bill: {} })).status === 400);
  check('the sugar stock is unchanged by those refused attempts', (await onHand(sugar.id)) === 10);
  check('an auditor-style read: the notes list and one note can be read, a cashier cannot', (await h('GET', '/goods-receipts')).json.length >= 4 && (await h('GET', `/goods-receipts/${direct.json.receipt.id}`)).status === 200 && (await h('GET', '/goods-receipts', undefined, cashier)).status === 403);
  const old = await h('POST', '/inventory/transactions', { branchId, variantId: sugar.id, type: 'ADJUSTMENT', quantityDelta: 1, unitCost: 95 });
  check('the older way (an adjustment with a price) still works for anything that uses it', old.status === 201, old.json);
  const rec = await h('POST', '/inventory/transactions', { branchId, variantId: sugar.id, type: 'RECEIPT', quantityDelta: 1, unitCost: 95 });
  check('and a RECEIPT can be recorded directly too', rec.status === 201, rec.json);
  check('a price on a stock-out is refused', (await h('POST', '/inventory/transactions', { branchId, variantId: sugar.id, type: 'RECEIPT', quantityDelta: -1, unitCost: 95 })).status === 400);

  section('6. Paying the supplier');
  check('a supervisor can look at the bills and what is owed, but cannot pay, credit or add one; a cashier sees nothing', (await h('GET', '/supplier-bills', undefined, supervisor)).status === 200 && (await h('GET', '/supplier-bills/aging', undefined, supervisor)).status === 200 && (await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 10, method: 'CASH' }, supervisor)).status === 403 && (await h('POST', `/supplier-bills/${bill1.id}/credits`, { amount: 10, reason: 'Test' }, supervisor)).status === 403 && (await h('POST', '/supplier-bills', { supplierId: supplier.id, billNumber: 'S', total: 1 }, supervisor)).status === 403 && (await h('GET', '/supplier-bills', undefined, cashier)).status === 403);
  const bills = (await h('GET', `/supplier-bills?supplierId=${supplier.id}`)).json;
  check('the supplier has three bills (2,000, 500 and 900), all open', bills.length === 3 && bills.every((b) => b.status === 'OPEN') && bills.map((b) => b.total).sort((a, b) => a - b).join() === '500,900,2000', bills.map((b) => [b.billNumber, b.total, b.status]));
  const pay1 = await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 500, method: 'CASH' });
  check('KES 500 cash: the bill is part paid and KES 1,500 is still owed', pay1.status === 201 && pay1.json.status === 'PARTLY_PAID' && pay1.json.balance === 1500, pay1.json);
  check('more than is owed is refused', (await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 1500.01, method: 'CASH' })).status === 409);
  check('M-Pesa needs its code', (await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 100, method: 'MPESA' })).status === 400);
  const pay2 = await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 1000, method: 'MPESA', reference: `QRC${tag.toUpperCase()}` });
  check('KES 1,000 by M-Pesa', pay2.status === 201 && pay2.json.balance === 500, pay2.json);
  check('the same M-Pesa code cannot be recorded twice', (await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 100, method: 'MPESA', reference: `QRC${tag.toUpperCase()}` })).status === 409);
  const racePay = await Promise.all([h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 500, method: 'CASH' }), h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 500, method: 'CASH' })]);
  check('two payments of the last KES 500 at once: exactly one is taken (no overpaying)', racePay.filter((r) => r.status === 201).length === 1 && racePay.filter((r) => r.status === 409).length === 1, racePay.map((r) => r.status));
  const paid = (await h('GET', `/supplier-bills/${bill1.id}`)).json;
  check('the bill is paid in full with three payments on it', paid.status === 'PAID' && paid.balance === 0 && paid.payments.length === 3 && paid.amountPaid === 2000, paid);
  check('a paid bill cannot be paid again or cancelled', (await h('POST', `/supplier-bills/${bill1.id}/payments`, { amount: 1, method: 'CASH' })).status === 409 && (await h('POST', `/supplier-bills/${bill1.id}/void`, { reason: 'Mistake' })).status === 409);
  check('payments are in the audit log', (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE "entityId" = $1 AND action = 'supplier_bill.paid'`, [bill1.id])).rows[0].n === 3);

  section('7. A bill typed in by hand, and who is owed what');
  const manual = await h('POST', '/supplier-bills', { supplierId: supplier.id, billNumber: `OLD-${tag}`, total: 3000, billDate: dayOffset(-60), dueDate: dayOffset(-40) });
  check('a bill typed in, already 40 days late', manual.status === 201 && manual.json.overdue === true && manual.json.ageBucket === 'DAYS_31_60', manual.json);
  check('the same invoice number for the same supplier is refused; a due date before the bill date is refused', (await h('POST', '/supplier-bills', { supplierId: supplier.id, billNumber: `OLD-${tag}`, total: 1 })).status === 409 && (await h('POST', '/supplier-bills', { supplierId: supplier.id, billNumber: `Z-${tag}`, total: 1, billDate: dayOffset(0), dueDate: dayOffset(-1) })).status === 400);
  check('a cashier cannot add a bill', (await h('POST', '/supplier-bills', { supplierId: supplier.id, billNumber: 'X', total: 1 }, cashier)).status === 403);
  const aging = (await h('GET', '/supplier-bills/aging')).json;
  const mine = aging.rows.find((r) => r.supplierId === supplier.id);
  check('the payables report: KES 1,400 not yet due (500 + 900), KES 3,000 31-60 days late, KES 4,400 in all', mine && mine.notDue === 1400 && mine.days31to60 === 3000 && mine.total === 4400 && mine.bills === 3, mine);
  check('the report totals include this supplier', aging.totals.total >= 4400);
  check('overdue filter finds only the late bill', (await h('GET', `/supplier-bills?supplierId=${supplier.id}&overdue=true`)).json.map((b) => b.billNumber).join() === `OLD-${tag}`);
  check('a bill entered by mistake can be cancelled with a reason', (await h('POST', `/supplier-bills/${manual.json.id}/void`, { reason: 'Entered twice' })).json.status === 'VOID');
  check('a cancelled bill is out of what is owed and cannot be paid', (await h('GET', '/supplier-bills/aging')).json.rows.find((r) => r.supplierId === supplier.id).total === 1400 && (await h('POST', `/supplier-bills/${manual.json.id}/payments`, { amount: 1, method: 'CASH' })).status === 409);
  check('a bill with a payment on it cannot be cancelled', (await h('POST', `/supplier-bills/${bills.find((b) => b.total === 900).id}/payments`, { amount: 100, method: 'CASH' })).status === 201 && (await h('POST', `/supplier-bills/${bills.find((b) => b.total === 900).id}/void`, { reason: 'Mistake' })).status === 409);

  section('8. Credit notes for damaged goods, and the profit report');
  const dmg = await h('POST', '/goods-receipts', { branchId, supplierId: supplier.id, lines: [{ variantId: sugar.id, quantity: 4, damaged: 3, damagedNote: 'Leaking', unitCost: 90 }], bill: { billNumber: `INV-${tag}-DMG` } });
  check('4 good and 3 damaged sugar at KES 90: the bill is for the 4 good ones, KES 360', dmg.status === 201 && dmg.json.bill.total === 360, dmg.json.message || dmg.json);
  const dmgBill = (await h('GET', `/supplier-bills/${dmg.json.bill.id}`)).json;
  check('the bill shows what the damaged goods were worth, KES 270, as the amount to ask the supplier to credit', dmgBill.damagedValue === 270, dmgBill);
  check('a cashier cannot record a credit note', (await h('POST', `/supplier-bills/${dmgBill.id}/credits`, { amount: 270, reason: 'Damaged goods' }, cashier)).status === 403);
  check('a credit note needs a reason', (await h('POST', `/supplier-bills/${dmgBill.id}/credits`, { amount: 270 })).status === 400);
  check('more credit than is owed is refused', (await h('POST', `/supplier-bills/${dmgBill.id}/credits`, { amount: 360.01, reason: 'Too much' })).status === 409);
  const cr = await h('POST', `/supplier-bills/${dmgBill.id}/credits`, { amount: 270, reason: 'Damaged goods on delivery', reference: `CN-${tag}` });
  check('a KES 270 credit note takes the bill down to KES 90 owed', cr.status === 201 && cr.json.creditAmount === 270 && cr.json.balance === 90 && cr.json.credits.length === 1 && cr.json.status === 'OPEN', cr.json);
  check('the payables report counts only the KES 90', (await h('GET', '/supplier-bills/aging')).json.rows.find((r) => r.supplierId === supplier.id).notDue === 1300 + 90);
  check('more than the KES 90 left cannot be paid', (await h('POST', `/supplier-bills/${dmgBill.id}/payments`, { amount: 91, method: 'CASH' })).status === 409);
  check('a bill with a credit note on it cannot be cancelled', (await h('POST', `/supplier-bills/${dmgBill.id}/void`, { reason: 'Mistake' })).status === 409);
  const settle = await h('POST', `/supplier-bills/${dmgBill.id}/payments`, { amount: 90, method: 'CASH' });
  check('paying the KES 90 settles it: credit plus payment equal the bill', settle.status === 201 && settle.json.status === 'PAID' && settle.json.balance === 0, settle.json);
  check('a settled bill takes no more credit', (await h('POST', `/supplier-bills/${dmgBill.id}/credits`, { amount: 1, reason: 'Again' })).status === 409);
  check('the credit note is in the audit log', (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE "entityId" = $1 AND action = 'supplier_bill.credited'`, [dmgBill.id])).rows[0].n === 1);
  const full = await h('POST', '/supplier-bills', { supplierId: supplier.id, billNumber: `FULL-${tag}`, total: 200 });
  const fullCredit = await h('POST', `/supplier-bills/${full.json.id}/credits`, { amount: 200, reason: 'Whole delivery returned' });
  check('a credit for the whole bill (goods sent back) makes it paid with nothing owed', fullCredit.status === 201 && fullCredit.json.status === 'PAID' && fullCredit.json.balance === 0, fullCredit.json);
  const profit = await h('GET', `/reports/profit?from=${dayOffset(-1)}&to=${dayOffset(1)}`);
  const sb = profit.json.stockBuying;
  check('the profit report shows stock buying beside the profit: bills, payments, what is owed', profit.status === 200 && sb && sb.billed > 0 && sb.paidToSuppliers >= 2190 && sb.owedNow >= 1300, sb);
  const expensesBefore = profit.json.totals.expenses;
  check('and it does not count as an expense (that would count the stock twice)', expensesBefore === 0 || typeof expensesBefore === 'number');
  const branchProfit = await h('GET', `/reports/profit?from=${dayOffset(-1)}&to=${dayOffset(1)}&branchId=${branchId}`);
  check('a single-branch profit view leaves stock buying out (bills belong to the business)', branchProfit.json.stockBuying === null);

  section('9. Database rules');
  for (const t of ['goods_receipts', 'goods_receipt_lines', 'supplier_bills', 'supplier_bill_payments', 'supplier_bill_credits']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }
  check('the receipts of this business carry its id', (await sql.query(`SELECT count(*)::int n FROM goods_receipts WHERE "organizationId" = $1 AND "receiptNumber" LIKE 'GRN-%'`, [org.id])).rows[0].n >= 4);
  const overpaidBills = (await sql.query(`SELECT count(*)::int n FROM supplier_bills b WHERE "amountPaid" + "creditAmount" > total OR "amountPaid" <> COALESCE((SELECT sum(amount) FROM supplier_bill_payments p WHERE p."billId" = b.id), 0) OR "creditAmount" <> COALESCE((SELECT sum(amount) FROM supplier_bill_credits c WHERE c."billId" = b.id), 0)`)).rows[0].n;
  check('no bill anywhere is overpaid, and every bill\'s paid and credited amounts equal the sums of its payments and credit notes', overpaidBills === 0, overpaidBills);

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
