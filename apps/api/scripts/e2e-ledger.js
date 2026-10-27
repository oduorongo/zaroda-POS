// End-to-end test of the general ledger against a LOCAL test setup: the chart of accounts is made on first use, the business's
// existing sales, refunds, expenses, bills and payments are posted from the start date, posting twice changes nothing, a void, a
// correction and a delete are reversed, manual journals balance, a closed period is respected, and the trial balance and balance
// sheet balance. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and apply-rls, the demo seed, and the API started with
// the test settings (LEDGER_SCHEDULER=off is fine: the test posts with the "post now" button).   node scripts/e2e-ledger.js
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 600) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, p, { token, body } = {}) {
  const response = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const sql = new Client({ connectionString: env.DIRECT_URL });
const nairobi = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  await sql.connect();
  check('API ready', (await call('GET', '/ready')).status === 200);
  const owner = (await call('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('owner can sign in', Boolean(owner));
  const h = (m, p, body, token = owner) => call(m, p, { token, body });
  const org = (await h('GET', '/organizations/me')).json;
  const branches = (await h('GET', '/branches')).json;
  const branchId = branches[0].id;
  // a clean set of books for this run
  for (const t of ['journal_lines', 'ledger_postings', 'ledger_accounts', 'ledger_settings']) await sql.query(`DELETE FROM ${t} WHERE "organizationId" = $1`, [org.id]);
  await sql.query(`UPDATE journal_entries SET "reversesId" = NULL WHERE "organizationId" = $1`, [org.id]);
  await sql.query(`DELETE FROM journal_entries WHERE "organizationId" = $1`, [org.id]);
  const email = `cashier-ledger-${tag}@demo.zaroda.pos`;
  await h('POST', '/org-users', { email, fullName: 'Ledger Cashier', password: 'password123', role: 'CASHIER', branchId });
  const cashier = (await call('POST', '/auth/login', { body: { email, password: 'password123' } })).json.accessToken;

  section('1. The books are protected');
  for (const t of ['ledger_accounts', 'ledger_settings', 'journal_entries', 'journal_lines', 'ledger_postings']) {
    const r = (await sql.query('SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1', [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }
  check('the books need a sign-in', (await call('GET', '/accounting/overview')).status === 401);
  check('a cashier cannot see the books', (await h('GET', '/accounting/reports/trial-balance', undefined, cashier)).status === 403);
  check('a cashier cannot post', (await h('POST', '/accounting/post-now', {}, cashier)).status === 403);

  section('2. Opening the books');
  const first = await h('GET', '/accounting/overview');
  check('the books start today, with nothing posted yet', first.status === 200 && first.json.startDate === nairobi() && first.json.entries === 0, first.json);
  const accounts = (await h('GET', '/accounting/accounts')).json;
  const key = (k) => accounts.find((a) => a.systemKey === k);
  check('the standard chart of accounts is made (cash, M-Pesa, bank, stock, VAT, sales, cost of sales...)', accounts.length >= 41 && ['CASH', 'MPESA', 'BANK', 'INVENTORY', 'AR', 'AP', 'VAT_OUTPUT', 'SALES', 'COGS', 'BAD_DEBTS'].every((k) => key(k)), accounts.length);
  check('accounts are in code order', accounts.map((a) => a.code).join() === [...accounts.map((a) => a.code)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join());
  check('the start date cannot be in the future', (await h('PATCH', '/accounting/settings', { startDate: nairobi(2) })).status === 400);
  const start = nairobi(-90);
  const moved = await h('PATCH', '/accounting/settings', { startDate: start, payrollPaidFrom: 'MPESA' });
  check('before anything is posted, the start can be moved back 90 days', moved.status === 200 && moved.json.startDate === start && moved.json.payrollPaidFrom === 'MPESA', moved.json);

  section('3. Posting what already happened');
  const pass1 = await h('POST', '/accounting/post-now', {});
  check('the first pass posts the existing records, with no failures', pass1.status === 201 && pass1.json.posted > 0 && pass1.json.failed === 0, pass1.json);
  if (pass1.json.failed) console.log('   note:', (await h('GET', '/accounting/overview')).json.lastPassNote);
  const startTs = new Date(new Date(`${start}T00:00:00Z`).getTime() - 3 * 3600_000);
  const dbSales = (await sql.query(`SELECT count(*)::int AS n, coalesce(sum(total),0)::float AS s FROM sales WHERE "organizationId" = $1 AND status = 'COMPLETED' AND "createdAt" >= $2`, [org.id, startTs])).rows[0];
  const salePostings = (await sql.query(`SELECT count(*)::int AS n FROM ledger_postings WHERE "organizationId" = $1 AND "sourceType" = 'SALE' AND "entryId" IS NOT NULL`, [org.id])).rows[0].n;
  const zeroSales = (await sql.query(`SELECT count(*)::int AS n FROM sales WHERE "organizationId" = $1 AND status = 'COMPLETED' AND "createdAt" >= $2 AND total = 0`, [org.id, startTs])).rows[0].n;
  check('every completed sale since the start has exactly one entry', salePostings === dbSales.n - zeroSales, { salePostings, dbSales, zeroSales });
  const saleCredits = (
    await sql.query(
      `SELECT coalesce(sum(l.credit - l.debit),0)::float AS s FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId" JOIN ledger_accounts a ON a.id = l."accountId"
       WHERE e."organizationId" = $1 AND e."sourceType" = 'SALE' AND e.kind = 'AUTO' AND a."systemKey" IN ('SALES', 'VAT_OUTPUT')`,
      [org.id],
    )
  ).rows[0].s;
  check('sales + VAT posted = what customers were charged', near(saleCredits, dbSales.s), { saleCredits, db: dbSales.s });
  const dbRefunds = (await sql.query(`SELECT count(*)::int AS n FROM refunds r JOIN sales s ON s.id = r."saleId" WHERE s."organizationId" = $1 AND r."createdAt" >= $2`, [org.id, startTs])).rows[0].n;
  const refundPostings = (await sql.query(`SELECT count(*)::int AS n FROM ledger_postings WHERE "organizationId" = $1 AND "sourceType" = 'REFUND'`, [org.id])).rows[0].n;
  check('every refund since the start is posted', refundPostings === dbRefunds, { refundPostings, dbRefunds });
  const unbalanced = (await sql.query(`SELECT e.number FROM journal_entries e JOIN journal_lines l ON l."entryId" = e.id WHERE e."organizationId" = $1 GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)`, [org.id])).rows;
  check('every single entry balances', unbalanced.length === 0, unbalanced);
  const tb1 = (await h('GET', '/accounting/reports/trial-balance')).json;
  check('the trial balance balances', tb1.balanced === true && tb1.debit === tb1.credit && tb1.debit > 0, { d: tb1.debit, c: tb1.credit });
  const bs1 = (await h('GET', '/accounting/reports/balance-sheet')).json;
  check('the balance sheet balances (assets = liabilities + equity + profit)', bs1.balanced === true && near(bs1.totalAssets, bs1.totalLiabilities + bs1.totalEquity), bs1);
  const pass2 = await h('POST', '/accounting/post-now', {});
  check('posting again changes nothing', pass2.json.posted === 0 && pass2.json.reposted === 0 && pass2.json.reversed === 0 && pass2.json.failed === 0, pass2.json);
  const before = (await h('GET', '/accounting/overview')).json.entries;

  section('4. A new sale, a refund and a void');
  const vat = (await h('POST', '/tax-classes', { name: `Ledger VAT ${tag}`, rate: 0.16, isExempt: false })).json;
  const p = (await h('POST', '/products', { name: `Ledger item ${tag}`, taxClassId: vat.id })).json;
  const v = (await h('POST', `/products/${p.id}/variants`, { sku: `LDG-${tag}`, price: 100, cost: 60 })).json;
  check('a product with a cost of 60 is made', Boolean(v.id), v);
  const terminalId = (await sql.query('SELECT id FROM terminals WHERE "branchId" = $1 ORDER BY "createdAt" LIMIT 1', [branchId])).rows[0].id;
  const ownerOrgUserId = (await sql.query(`SELECT ou.id FROM org_users ou JOIN users u ON u.id = ou."userId" WHERE u.email = 'owner@demo.zaroda.pos' AND ou."organizationId" = $1`, [org.id])).rows[0].id;
  const till = await call('POST', '/auth/pin-login', { body: { terminalId, orgUserId: ownerOrgUserId, pin: '1234' } });
  const cashierSessionId = till.json.cashierSessionId;
  const sell = (qty, payments) => h('POST', '/sales', { clientId: randomUUID(), branchId, terminalId, cashierSessionId, lineItems: [{ variantId: v.id, quantity: qty }], payments });
  const s1 = await sell(1, [{ method: 'CASH', amount: 116 }]);
  const s2 = await sell(2, [{ method: 'CASH', amount: 100 }, { method: 'CARD', amount: 132 }]);
  check('two sales are made (116 cash; 232 cash and card)', s1.status === 201 && s2.status === 201, [s1.json, s2.json]);
  const pass3 = (await h('POST', '/accounting/post-now', {})).json;
  check('the next pass posts just those two', pass3.posted === 2 && pass3.failed === 0, pass3);
  const entryFor = async (type, id) => (await h('GET', `/accounting/journals?sourceType=${type}&sourceId=${id}`)).json.rows;
  const e1 = (await h('GET', `/accounting/journals/${(await entryFor('SALE', s1.json.id))[0].id}`)).json;
  const line = (e, k) => e.lines.find((l) => l.code === key(k).code) ?? { debit: 0, credit: 0 };
  check('the cash sale: cash 116 in, sales 100 and VAT 16 out', line(e1, 'CASH').debit === 116 && line(e1, 'SALES').credit === 100 && line(e1, 'VAT_OUTPUT').credit === 16, e1.lines);
  check('and the cost of what was sold (60) moves out of stock', line(e1, 'COGS').debit === 60 && line(e1, 'INVENTORY').credit === 60, e1.lines);
  check('it is dated the day of the sale, from the sale', e1.date === nairobi() && e1.kind === 'AUTO' && e1.source === 'Sale', e1);
  const e2 = (await h('GET', `/accounting/journals/${(await entryFor('SALE', s2.json.id))[0].id}`)).json;
  check('the split sale: 100 cash and 132 waiting from the card company', line(e2, 'CASH').debit === 100 && line(e2, 'CARD_CLEARING').debit === 132 && line(e2, 'SALES').credit === 200 && line(e2, 'COGS').debit === 120, e2.lines);

  const ref = await h('POST', `/sales/${s2.json.id}/refunds`, { clientId: randomUUID(), amount: 58, reason: 'one returned, half price', approvedById: ownerOrgUserId });
  check('a refund of 58 is given', ref.status === 201, ref.json);
  const refundId = (await sql.query('SELECT id FROM refunds WHERE "saleId" = $1 ORDER BY "createdAt" DESC LIMIT 1', [s2.json.id])).rows[0].id;
  const voided = await h('PATCH', `/sales/${s1.json.id}/void`, { reason: 'ledger test' });
  check('the cash sale is voided', voided.status === 200, voided.json);
  const pass4 = (await h('POST', '/accounting/post-now', {})).json;
  check('the next pass posts the refund and reverses the voided sale', pass4.posted === 1 && pass4.reversed === 1 && pass4.failed === 0, pass4);
  const refE = (await h('GET', `/accounting/journals/${(await entryFor('REFUND', refundId))[0].id}`)).json;
  check('the refund gives back 8 of VAT and 50 off sales, paid back by card (most of the sale)', line(refE, 'VAT_OUTPUT').debit === 8 && line(refE, 'SALES_RETURNS').debit === 50 && line(refE, 'CARD_CLEARING').credit === 58, refE.lines);
  const s1Entries = await entryFor('SALE', s1.json.id);
  const original = s1Entries.find((e) => e.kind === 'AUTO');
  const undo = s1Entries.find((e) => e.kind === 'REVERSAL');
  check('the voided sale keeps its entry, with a reversal pointing at it', s1Entries.length === 2 && original.reversedBy?.id === undo.id && undo.amount === original.amount, s1Entries);
  const autoReverse = await h('POST', `/accounting/journals/${original.id}/reverse`, {});
  check('an automatic entry cannot be reversed by hand (fix the sale instead)', autoReverse.status === 400 && /automatically/.test(autoReverse.json.message), autoReverse.json);

  section('5. Expenses: recorded, corrected, deleted');
  const exp = await h('POST', '/expenses', { spentOn: nairobi(-1), category: 'UTILITIES', amount: 2500, description: `power ${tag}`, paidWith: 'MPESA' });
  await h('POST', '/accounting/post-now', {});
  let expEntries = await entryFor('EXPENSE', exp.json.id);
  const expE = (await h('GET', `/accounting/journals/${expEntries[0].id}`)).json;
  check('an expense is posted to its own account, from M-Pesa, on the day spent', expE.date === nairobi(-1) && line(expE, 'EXP_UTILITIES').debit === 2500 && line(expE, 'MPESA').credit === 2500, expE);
  await h('PATCH', `/expenses/${exp.json.id}`, { description: `power ${tag} (note only)` });
  const sameP = (await h('POST', '/accounting/post-now', {})).json;
  check('changing only the note posts nothing new', sameP.reposted === 0 && sameP.reversed === 0, sameP);
  await h('PATCH', `/expenses/${exp.json.id}`, { amount: 2700, paidWith: 'CASH' });
  const fixP = (await h('POST', '/accounting/post-now', {})).json;
  expEntries = await entryFor('EXPENSE', exp.json.id);
  check('correcting the amount reverses the old entry and posts the new one', fixP.reposted === 1 && expEntries.length === 3 && expEntries.filter((e) => e.kind === 'REVERSAL').length === 1, { fixP, expEntries });
  const nowE = expEntries.find((e) => e.kind === 'AUTO' && !e.reversedBy);
  check('the standing entry is the corrected 2,700', nowE?.amount === 2700, nowE);
  await h('DELETE', `/expenses/${exp.json.id}`);
  const delP = (await h('POST', '/accounting/post-now', {})).json;
  expEntries = await entryFor('EXPENSE', exp.json.id);
  check('deleting it reverses what was standing', delP.reversed === 1 && expEntries.filter((e) => e.kind === 'AUTO').every((e) => e.reversedBy), { delP, expEntries });

  section('6. Journals the business enters');
  const capital = await h('POST', '/accounting/journals', {
    date: nairobi(),
    memo: `Owner put money in ${tag}`,
    lines: [
      { accountId: key('BANK').id, debit: 50000, credit: 0 },
      { accountId: key('CAPITAL').id, debit: 0, credit: 50000 },
    ],
  });
  check("the owner's money in is recorded as a journal", capital.status === 201 && capital.json.kind === 'MANUAL' && capital.json.lines.length === 2 && Boolean(capital.json.createdByName), capital.json);
  const bad = await h('POST', '/accounting/journals', { date: nairobi(), memo: 'wrong', lines: [{ accountId: key('BANK').id, debit: 100, credit: 0 }, { accountId: key('CAPITAL').id, debit: 0, credit: 90 }] });
  check("a journal that doesn't balance is refused", bad.status === 400 && /must be equal/.test(bad.json.message), bad.json);
  check('a journal with one line is refused', (await h('POST', '/accounting/journals', { date: nairobi(), memo: 'one', lines: [{ accountId: key('BANK').id, debit: 1, credit: 0 }] })).status === 400);
  check('a journal dated in the future is refused', (await h('POST', '/accounting/journals', { date: nairobi(3), memo: 'later', lines: [{ accountId: key('BANK').id, debit: 1, credit: 0 }, { accountId: key('CAPITAL').id, debit: 0, credit: 1 }] })).status === 400);
  check('a cashier cannot enter a journal', (await h('POST', '/accounting/journals', { date: nairobi(), memo: 'x', lines: [] }, cashier)).status === 403);
  const opening = await h('POST', '/accounting/journals', {
    date: start,
    kind: 'OPENING',
    memo: 'Opening balances',
    lines: [
      { accountId: key('CASH').id, debit: 1000, credit: 0 },
      { accountId: key('OPENING_BALANCE').id, debit: 0, credit: 1000 },
    ],
  });
  check('opening balances can be entered on the start day', opening.status === 201 && opening.json.kind === 'OPENING', opening.json);
  const rev = await h('POST', `/accounting/journals/${capital.json.id}/reverse`, { reason: 'entered twice' });
  check('a journal can be reversed, with the reason', rev.status === 201 && rev.json.kind === 'REVERSAL' && rev.json.reverses?.id === capital.json.id && /entered twice/.test(rev.json.memo), rev.json);
  check('but only once', (await h('POST', `/accounting/journals/${capital.json.id}/reverse`, {})).status === 409);
  check('a reversal is not itself reversed', (await h('POST', `/accounting/journals/${rev.json.id}/reverse`, {})).status === 400);

  section('7. Accounts');
  const own = await h('POST', '/accounting/accounts', { code: `61${Math.floor(Math.random() * 90 + 10)}`, name: 'Security guards', type: 'EXPENSE' });
  check('the business can add its own account', own.status === 201 && own.json.systemKey === null, own.json);
  check('a code already used is refused', (await h('POST', '/accounting/accounts', { code: own.json.code, name: 'Again', type: 'EXPENSE' })).status === 409);
  check('a system account cannot be switched off', (await h('PATCH', `/accounting/accounts/${key('CASH').id}`, { active: false })).status === 400);
  check("a system account's kind cannot change", (await h('PATCH', `/accounting/accounts/${key('CASH').id}`, { type: 'EXPENSE' })).status === 400);
  const renamed = await h('PATCH', `/accounting/accounts/${key('CASH').id}`, { name: 'Cash in the till' });
  check('but it can be renamed', renamed.status === 200 && renamed.json.name === 'Cash in the till', renamed.json);
  await h('PATCH', `/accounting/accounts/${key('CASH').id}`, { name: 'Cash on hand' });
  const off = await h('PATCH', `/accounting/accounts/${own.json.id}`, { active: false });
  check("the business's own account can be switched off", off.status === 200 && off.json.active === false);
  check('and a switched-off account cannot be used in a journal', (await h('POST', '/accounting/journals', { date: nairobi(), memo: 'guards', lines: [{ accountId: own.json.id, debit: 10, credit: 0 }, { accountId: key('CASH').id, debit: 0, credit: 10 }] })).status === 400);
  const tb = (await h('GET', '/accounting/reports/trial-balance')).json;
  const ledger = (await h('GET', `/accounting/accounts/${key('CASH').id}/ledger?from=${start}&to=${nairobi()}`)).json;
  const tbCash = tb.rows.find((r) => r.accountId === key('CASH').id);
  check("the cash account's ledger ends on its trial-balance figure", near(ledger.closing, (tbCash?.debit ?? 0) - (tbCash?.credit ?? 0)) && ledger.opening === 0, { closing: ledger.closing, tbCash });
  check('the running balance adds up line by line', ledger.lines.every((l, i) => near(l.balance, (i ? ledger.lines[i - 1].balance : ledger.opening) + l.debit - l.credit)));

  section('8. Closing a period');
  check('a cashier cannot close the books', (await h('PATCH', '/accounting/settings', { lockDate: nairobi(-1) }, cashier)).status === 403);
  check('the books cannot be closed up to today', (await h('PATCH', '/accounting/settings', { lockDate: nairobi() })).status === 400);
  const locked = await h('PATCH', '/accounting/settings', { lockDate: nairobi(-1) });
  check('the owner closes the books up to yesterday', locked.status === 200 && locked.json.lockDate === nairobi(-1), locked.json);
  const late = await h('POST', '/accounting/journals', { date: nairobi(-1), memo: 'late', lines: [{ accountId: key('BANK').id, debit: 1, credit: 0 }, { accountId: key('CAPITAL').id, debit: 0, credit: 1 }] });
  check('a journal in the closed period is refused', late.status === 400 && /closed/.test(late.json.message), late.json);
  const lateExp = await h('POST', '/expenses', { spentOn: nairobi(-2), category: 'TRANSPORT', amount: 300, description: `late ${tag}` });
  await h('POST', '/accounting/post-now', {});
  const lateE = (await entryFor('EXPENSE', lateExp.json.id))[0];
  check('an expense recorded late for a closed day is posted on the first open day', lateE?.date === nairobi(), lateE);
  check('the start date cannot be moved later once things are posted', (await h('PATCH', '/accounting/settings', { startDate: nairobi(-10) })).status === 409);
  const reopened = await h('PATCH', '/accounting/settings', { lockDate: null });
  check('the owner can open the books again', reopened.status === 200 && reopened.json.lockDate === null, reopened.json);

  section('9. The statements at the end');
  const pass9 = (await h('POST', '/accounting/post-now', {})).json;
  check('a last pass has nothing left to do', pass9.posted === 0 && pass9.reposted === 0 && pass9.reversed === 0 && pass9.failed === 0, pass9);
  const tb9 = (await h('GET', '/accounting/reports/trial-balance')).json;
  check('the trial balance still balances', tb9.balanced === true, { d: tb9.debit, c: tb9.credit });
  const bs9 = (await h('GET', '/accounting/reports/balance-sheet')).json;
  check('the balance sheet still balances', bs9.balanced === true, bs9);
  const pl = (await h('GET', `/accounting/reports/profit-loss?from=${start}&to=${nairobi()}`)).json;
  check('profit and loss: gross profit = income - cost of sales; net = gross - expenses', near(pl.grossProfit, pl.totalIncome - pl.totalCostOfSales) && near(pl.netProfit, pl.grossProfit - pl.totalExpenses), pl);
  check('profit to date on the balance sheet = the profit and loss since the start', near(bs9.profitToDate, pl.netProfit), { bs: bs9.profitToDate, pl: pl.netProfit });
  check('a backwards range is refused', (await h('GET', `/accounting/reports/profit-loss?from=${nairobi()}&to=${start}`)).status === 400);
  const list = (await h('GET', '/accounting/journals?page=1')).json;
  check('the journal list is newest first, 50 to a page, with a total', list.rows.length <= 50 && list.total > before && list.rows[0].date >= list.rows[list.rows.length - 1].date, { total: list.total });

  await sql.query(`DELETE FROM expenses WHERE "organizationId" = $1 AND description LIKE $2`, [org.id, `%${tag}%`]);
  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
