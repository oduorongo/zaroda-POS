// End-to-end test of petty cash against the LOCAL test setup: a business's box (float, vouchers that are expenses, top-ups,
// counts, voids, the book) and its postings; and ZARODA's own petty cash in the platform books. Refuses the live database.
//
// Needs: test Postgres (5433) migrated + apply-rls, the demo seed, the API started with `pnpm --filter api start:test`.
//   node scripts/e2e-petty-cash.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 600) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const tag = Date.now().toString(36);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  check('API ready', (await call('GET', '/ready')).status === 200);

  section('1. A business sets up a petty cash box');
  const reg = await call('POST', '/auth/register', { body: { organizationName: `Petty ${tag}`, industryType: 'RETAIL', ownerFullName: 'Owner Petty', ownerEmail: `petty-${tag}@test.local`, ownerPassword: 'password123', branchName: 'Main' } });
  const owner = reg.json.accessToken;
  const h = (m, p, body, token = owner) => call(m, p, { token, body });
  const branchId = (await h('GET', '/branches')).json[0].id;
  check('petty cash needs a sign-in', (await call('GET', '/petty-cash/boxes')).status === 401);
  check('a float must be positive', (await h('POST', '/petty-cash/boxes', { name: 'Box', floatAmount: 0, from: 'CASH' })).status === 400);
  const box = await h('POST', '/petty-cash/boxes', { name: `Front office ${tag}`, branchId, floatAmount: 5000, holderName: 'Jane', from: 'CASH' });
  check('a box with a KES 5,000 float from the till is set up', box.status === 201, box.json);
  let boxes = (await h('GET', '/petty-cash/boxes')).json;
  let b = boxes.find((x) => x.id === box.json.id);
  check('it holds 5,000 and needs no top-up', near(b.balance, 5000) && near(b.topUpNeeded, 0) && b.branchName === 'Main', b);

  section('2. Vouchers');
  check('a voucher needs a known category', (await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 100, category: 'NOPE', description: 'x x', receivedBy: 'Juma' })).status === 400);
  const tooBig = await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 6000, category: 'TRANSPORT', description: 'Lorry', receivedBy: 'Juma' });
  check('paying more than the box holds is refused', tooBig.status === 400 && /Top it up/.test(tooBig.json.message), tooBig.json);
  check('a voucher cannot be dated in the future', (await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 10, category: 'TRANSPORT', description: 'Boda', receivedBy: 'Juma', occurredOn: '2099-01-01' })).status === 400);
  const v1 = await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 350, category: 'TRANSPORT', description: 'Boda to Rongo', receivedBy: 'Juma' });
  const v2 = await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 1160, category: 'SUPPLIES', description: 'Cleaning things', receivedBy: 'Mama Wanjiku', taxAmount: 160, supplierPin: 'p051234567x', kraInvoiceNo: 'INV-77' });
  const v3 = await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 200, category: 'OTHER', description: 'Wrong entry', receivedBy: 'Nobody' });
  check('three vouchers with PCV numbers', [v1, v2, v3].every((v) => v.status === 201 && /^PCV-\d{4}-\d{4}$/.test(v.json.voucherNumber)), [v1.json, v2.json, v3.json]);
  check('the balance goes down with each (3,290 left)', near(v3.json.balance, 3290), v3.json);
  const expenses = (await h('GET', '/expenses')).json;
  const list = Array.isArray(expenses) ? expenses : expenses.items ?? [];
  const e2 = list.find((e) => e.description && e.description.startsWith(v2.json.voucherNumber));
  check('each voucher is an expense paid with petty cash (with its VAT and PIN)', e2 && e2.paidWith === 'PETTY_CASH' && near(e2.amount, 1160) && near(e2.taxAmount, 160) && e2.supplierPin === 'P051234567X', e2);
  check('the expense cannot be changed or deleted on the Expenses screen', (await h('PATCH', `/expenses/${e2.id}`, { amount: 1 })).status === 400 && (await h('DELETE', `/expenses/${e2.id}`)).status === 400);
  const voided = await h('POST', `/petty-cash/entries/${v3.json.id}/void`, { reason: 'Typed by mistake' });
  const after = (await h('GET', '/expenses')).json;
  const afterList = Array.isArray(after) ? after : after.items ?? [];
  check('a wrong voucher is voided, and its expense is gone', voided.status === 200 && afterList.length > 0 && !afterList.some((e) => (e.description ?? '').startsWith(v3.json.voucherNumber)), voided.json);
  check('a voided voucher cannot be voided again', (await h('POST', `/petty-cash/entries/${v3.json.id}/void`, { reason: 'again' })).status === 400);
  b = (await h('GET', '/petty-cash/boxes')).json.find((x) => x.id === b.id);
  check('the box is back to 3,490 and needs 1,510 to top up', near(b.balance, 3490) && near(b.topUpNeeded, 1510), b);

  section('3. Top-ups and counts');
  const top = await h('POST', `/petty-cash/boxes/${b.id}/top-up`, { from: 'MPESA' });
  check('a top-up with no amount brings the box back to its float (1,510 by M-Pesa)', top.status === 201 && near(top.json.amount, 1510) && near(top.json.balance, 5000), top.json);
  check('topping up a full box with no amount is refused', (await h('POST', `/petty-cash/boxes/${b.id}/top-up`, { from: 'CASH' })).status === 400);
  const count = await h('POST', `/petty-cash/boxes/${b.id}/count`, { counted: 4950, description: 'Coins missing' });
  check('a count of 4,950 records 50 short', count.status === 201 && near(count.json.difference, -50) && near(count.json.expected, 5000), count.json);
  const v4 = await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 4000, category: 'REPAIRS', description: 'Door lock', receivedBy: 'Fundi' });
  check('a big voucher of 4,000', v4.status === 201);
  const topBook = (await h('GET', `/petty-cash/boxes/${b.id}/book`)).json;
  const topLine = topBook.lines.find((l) => l.kind === 'TOP_UP' && near(l.moneyIn, 1510));
  const spent = await h('POST', `/petty-cash/entries/${topLine.id}/void`, { reason: 'try' });
  check('a top-up already spent cannot be voided', spent.status === 400 && /already spent/.test(spent.json.message), spent.json);

  section('4. The petty cash book');
  const book = (await h('GET', `/petty-cash/boxes/${b.id}/book`)).json;
  check('the book starts at 0, runs every line, and ends at 950', near(book.opening, 0) && near(book.closing, 950) && book.lines.length === 7, { closing: book.closing, n: book.lines.length });
  check('voided lines are shown but move nothing', book.lines.some((l) => l.voided && l.moneyOut === 0 && l.voucherNumber === v3.json.voucherNumber));
  check('paid out 5,510 (350 + 1,160 + 4,000), topped up 6,510', near(book.paidOut, 5510) && near(book.toppedUp, 6510), book);

  section('5. The books');
  await h('GET', '/accounting/overview');
  const pass = (await h('POST', '/accounting/post-now', {})).json;
  check('posting works', pass.failed === 0, pass);
  const tb = (await h('GET', '/accounting/reports/trial-balance')).json;
  check('the trial balance balances', tb.balanced === true, { d: tb.debit, c: tb.credit });
  const pc = (tb.rows ?? []).find((r) => r.code === '1005');
  check('Petty cash (1005) holds 950', pc && near(pc.debit - pc.credit, 950), pc);
  const tops = (await h('GET', `/accounting/journals?sourceType=PETTY_CASH&sourceId=${top.json.id}`)).json.rows;
  check('the M-Pesa top-up is posted', tops.length === 1, tops);
  const pl = (await h('GET', '/accounting/reports/profit-loss')).json;
  check('the vouchers and the 50 shortage are costs in the profit and loss', near(pl.totalExpenses, 350 + 1000 + 4000 + 50), pl);

  section('6. Another business cannot see this box');
  const other = (await call('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('another business does not list it', !(await h('GET', '/petty-cash/boxes', undefined, other)).json.some((x) => x.id === b.id));
  check('nor pay from it', (await h('POST', `/petty-cash/boxes/${b.id}/pay`, { amount: 1, category: 'OTHER', description: 'xx', receivedBy: 'xx' }, other)).status === 404);

  section("7. ZARODA's own petty cash");
  const admin = (await call('POST', '/platform-admin/auth/login', { body: { email: 'admin@test.local', password: 'test-admin-password' } })).json.accessToken;
  const pa = (m, p, body) => call(m, `/platform-admin/accounting${p}`, { token: admin, body });
  check("a business owner cannot open ZARODA's petty cash", (await call('GET', '/platform-admin/accounting/petty-cash', { token: owner })).status === 401);
  check('the float is set to 3,000', (await pa('PATCH', '/settings', { pettyCashFloat: 3000 })).json.pettyCashFloat === 3000);
  const start = (await pa('GET', '/petty-cash')).json;
  const ptop = await pa('POST', '/petty-cash/top-up', { from: 'BANK' });
  check('a top-up with no amount fills it to the float from the bank', ptop.status === 201 && near(Number(ptop.json.amount), 3000 - start.balance), ptop.json);
  const accts = (await pa('GET', '/accounts')).json;
  const other6900 = accts.find((a) => a.systemKey === 'OTHER_EXPENSES');
  const tax = accts.find((a) => a.systemKey === 'INCOME_TAX');
  check('income tax cannot be paid from petty cash', (await pa('POST', '/petty-cash/pay', { amount: 10, accountId: tax.id, description: 'Tax', receivedBy: 'KRA' })).status === 400);
  check('an income account cannot be charged', (await pa('POST', '/petty-cash/pay', { amount: 10, accountId: accts.find((a) => a.systemKey === 'SUBSCRIPTION_INCOME').id, description: 'x x', receivedBy: 'x x' })).status === 400);
  const ppay = await pa('POST', '/petty-cash/pay', { amount: 450, accountId: other6900.id, description: `Office tea ${tag}`, receivedBy: 'Office' });
  check('a ZARODA voucher (ZPCV-) is posted at once', ppay.status === 201 && /^ZPCV-\d{4}-\d{4}$/.test(ppay.json.voucherNumber) && Boolean(ppay.json.entryId), ppay.json);
  const j = (await pa('GET', `/journals/${ppay.json.entryId}`)).json;
  check('its journal: other expenses 450 debit, petty cash 450 credit', j.lines?.some((l) => l.code === '6900' && near(l.debit, 450)) && j.lines?.some((l) => l.code === '1005' && near(l.credit, 450)), j.lines);
  check('the automatic entry cannot be reversed by hand', (await pa('POST', `/journals/${ppay.json.entryId}/reverse`, { reason: 'x' })).status === 400);
  const pvoid = await pa('POST', `/petty-cash/${ppay.json.id}/void`, { reason: 'test' });
  check('voiding it reverses the journal', pvoid.status === 201 && Boolean(pvoid.json.voidedAt), pvoid.json);
  const pbook = (await pa('GET', '/petty-cash')).json;
  check('ZARODA petty cash is back to its float', near(pbook.balance, 3000) && near(pbook.topUpNeeded, 0), pbook);
  const pcount = await pa('POST', '/petty-cash/count', { counted: 3000 });
  check('a correct count posts nothing', pcount.status === 201 && !pcount.json.entryId, pcount.json);
  const ptb = (await pa('GET', '/reports/trial-balance')).json;
  check("ZARODA's trial balance still balances", ptb.balanced === true);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
