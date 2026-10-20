// End-to-end test of expenses and the profit report against a LOCAL test setup: expenses are recorded, corrected and
// deleted (with audit entries), and the profit report reconciles with what is in the database. Never touches the live
// system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and `node scripts/with-env-local.js node
// scripts/apply-rls.js` applied, and the API started with the test settings, plus the demo seed.
//   node scripts/e2e-expenses-profit.js
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
const section = (t) => console.log(`\n${t}`);
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const nairobi = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('owner can sign in', Boolean(owner));
  // The owner's own business (the demo shop's), not just any business in the test database.
  const slug = (await api('GET', '/online-store/me', { token: owner })).json.slug;
  const orgId = (await sql.query('SELECT "organizationId" AS id FROM online_stores WHERE slug = $1', [slug])).rows[0].id;
  await sql.query(`DELETE FROM expenses WHERE "organizationId" = $1`, [orgId]);

  section('1. Expenses are protected');
  check('the expenses table has row-level security switched on', (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'expenses'`)).rows[0]?.on === true);
  check('expenses need a sign-in', (await api('GET', '/expenses')).status === 401);
  check('profit needs a sign-in', (await api('GET', `/reports/profit?from=${nairobi()}&to=${nairobi()}`)).status === 401);

  section('2. Recording expenses');
  const cats = await api('GET', '/expenses/categories', { token: owner });
  check('the categories are listed', cats.status === 200 && cats.json.some((c) => c.key === 'RENT') && !cats.json.some((c) => /stock/i.test(c.label)), cats.json);
  const branches = (await api('GET', '/branches', { token: owner })).json;
  const rent = await api('POST', '/expenses', { token: owner, body: { spentOn: nairobi(-1), category: 'RENT', amount: 12000, description: 'October rent', paidWith: 'MPESA' } });
  check('rent is recorded', rent.status === 201 && rent.json.amount === 12000 && rent.json.categoryLabel === 'Rent', rent);
  const fuel = await api('POST', '/expenses', { token: owner, body: { spentOn: nairobi(0), category: 'TRANSPORT', amount: 1500.5, branchId: branches[0].id } });
  check('a branch expense with cents is recorded', fuel.status === 201 && fuel.json.amount === 1500.5 && fuel.json.branchName === branches[0].name, fuel);
  check('a made-up category is refused', (await api('POST', '/expenses', { token: owner, body: { spentOn: nairobi(), category: 'STOCK', amount: 10 } })).status === 400);
  check('a zero amount is refused', (await api('POST', '/expenses', { token: owner, body: { spentOn: nairobi(), category: 'RENT', amount: 0 } })).status === 400);
  check('an amount with 3 decimals is refused', (await api('POST', '/expenses', { token: owner, body: { spentOn: nairobi(), category: 'RENT', amount: 10.123 } })).status === 400);
  const future = await api('POST', '/expenses', { token: owner, body: { spentOn: nairobi(3), category: 'RENT', amount: 10 } });
  check('a future date is refused', future.status === 400 && /future/.test(future.json.message), future);

  const list = await api('GET', `/expenses?from=${nairobi(-30)}&to=${nairobi()}`, { token: owner });
  check('the list shows both with a total and a breakdown', list.status === 200 && list.json.items.length === 2 && list.json.total === 13500.5 && list.json.byCategory[0].category === 'RENT', list.json);
  const onlyFuel = await api('GET', `/expenses?category=TRANSPORT`, { token: owner });
  check('it can be filtered by category', onlyFuel.json.items.length === 1 && onlyFuel.json.items[0].id === fuel.json.id);

  section('3. Correcting and deleting');
  const edited = await api('PATCH', `/expenses/${rent.json.id}`, { token: owner, body: { amount: 13000, description: 'October rent (revised)' } });
  check('an expense can be corrected', edited.status === 200 && edited.json.amount === 13000 && edited.json.spentOn === nairobi(-1), edited);
  const audit = await sql.query(`SELECT action FROM audit_log WHERE "organizationId" = $1 AND "entityType" = 'Expense' ORDER BY "createdAt"`, [orgId]);
  check('creating and correcting both left an audit entry', audit.rows.filter((r) => r.action === 'expense.created').length >= 2 && audit.rows.some((r) => r.action === 'expense.updated'), audit.rows);
  const del = await api('DELETE', `/expenses/${fuel.json.id}`, { token: owner });
  check('an expense can be deleted', del.status === 200 && del.json.deleted === true, del);
  check('and the delete is audited', (await sql.query(`SELECT 1 FROM audit_log WHERE "entityId" = $1 AND action = 'expense.deleted'`, [fuel.json.id])).rowCount === 1);
  check('a deleted one is gone', (await api('GET', '/expenses', { token: owner })).json.items.length === 1);
  check('deleting a made-up id says not found', (await api('DELETE', `/expenses/00000000-0000-4000-8000-000000000000`, { token: owner })).status === 404);

  section('4. The profit report');
  const from = nairobi(-60);
  const to = nairobi(0);
  const report = await api('GET', `/reports/profit?from=${from}&to=${to}`, { token: owner });
  check('the report loads', report.status === 200 && report.json.totals && Array.isArray(report.json.periods), report);
  const t = report.json.totals;
  const start = new Date(`${from}T00:00:00Z`).getTime() - 3 * 3600_000;
  const endEx = new Date(`${to}T00:00:00Z`).getTime() + 86_400_000 - 3 * 3600_000;
  const dbSales = (await sql.query(`SELECT count(*)::int AS n, coalesce(sum(total),0)::float AS s FROM sales WHERE "organizationId" = $1 AND status = 'COMPLETED' AND "createdAt" >= $2 AND "createdAt" < $3`, [orgId, new Date(start), new Date(endEx)])).rows[0];
  check('the sales and their number match the database', t.saleCount === dbSales.n && Math.abs(t.sales - dbSales.s) < 0.01, { report: [t.saleCount, t.sales], db: dbSales });
  check('the expenses match what was recorded (13,000)', t.expenses === 13000, t);
  check('net sales = sales - tax - refunds', Math.abs(t.netSales - (t.sales - t.tax - t.refunds)) < 0.01, t);
  check('gross profit = net sales - cost of goods', Math.abs(t.grossProfit - (t.netSales - t.costOfGoods)) < 0.01, t);
  check('net profit = gross profit - waste - expenses - payroll', Math.abs(t.netProfit - (t.grossProfit - t.waste - t.expenses - t.payroll)) < 0.01, t);
  const sum = (k) => Math.round(report.json.periods.reduce((s, p) => s + p[k], 0) * 100) / 100;
  check('the days add up to the total (sales, expenses, profit)', sum('sales') === t.sales && sum('expenses') === t.expenses && Math.abs(sum('netProfit') - t.netProfit) < 0.02, { days: [sum('sales'), sum('expenses'), sum('netProfit')], total: t });
  check('a 60-day report is by week, as promised', report.json.groupBy === 'day' || report.json.groupBy === 'week', report.json.groupBy);
  const yesterday = (await api('GET', `/reports/profit?from=${nairobi(-1)}&to=${nairobi(-1)}`, { token: owner })).json;
  check('one day: the rent lands on the day it was spent', yesterday.totals.expenses === 13000 && yesterday.periods.length === 1, yesterday);
  const today = (await api('GET', `/reports/profit?from=${nairobi(0)}&to=${nairobi(0)}`, { token: owner })).json;
  check('and not on another day', today.totals.expenses === 0, today.totals);
  const monthly = await api('GET', `/reports/profit?from=${nairobi(-90)}&to=${nairobi(0)}&groupBy=month`, { token: owner });
  check('it can be shown by month', monthly.status === 200 && monthly.json.periods.every((p) => /^\d{4}-\d{2}$/.test(p.key)), monthly.json.periods);
  const weekly = await api('GET', `/reports/profit?from=${nairobi(-20)}&to=${nairobi(0)}&groupBy=week`, { token: owner });
  check('or by week (each row starts on a Monday)', weekly.status === 200 && weekly.json.periods.every((p) => new Date(`${p.key}T00:00:00Z`).getUTCDay() === 1), weekly.json.periods.map((p) => p.key));
  check('a backwards range is refused', (await api('GET', `/reports/profit?from=${nairobi(0)}&to=${nairobi(-5)}`, { token: owner })).status === 400);
  check('a range over a year is refused', (await api('GET', `/reports/profit?from=${nairobi(-400)}&to=${nairobi(0)}`, { token: owner })).status === 400);
  const oneBranch = await api('GET', `/reports/profit?from=${nairobi(-1)}&to=${nairobi(-1)}&branchId=${branches[0].id}`, { token: owner });
  check('a single branch leaves out business-wide expenses', oneBranch.status === 200 && oneBranch.json.totals.expenses === 0, oneBranch.json.totals);

  await sql.query(`DELETE FROM expenses WHERE "organizationId" = $1`, [orgId]);
  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
