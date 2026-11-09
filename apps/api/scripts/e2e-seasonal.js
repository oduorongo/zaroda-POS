// End-to-end test of seasonal (school-term) billing against a LOCAL test setup: a school supplier signs up onto the seasonal plan with
// the right instalments, the platform admin's settings and due-date shift, an overdue term locking the business to read-only (it can
// still look and pay), a payment opening it again at once, commission flags, and a monthly business left untouched.
// Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and apply-rls, the demo seed, and the API started with the
// test settings (SEASONAL_SCHEDULER=off is fine).   node scripts/e2e-seasonal.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR] }));
const readEnv = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};
const env = readEnv(path.join(API_DIR, process.env.ENV_FILE || '.env.local'));
const dbUrl = new URL(env.DIRECT_URL);
if (!(dbUrl.hostname === 'localhost' && dbUrl.port === '5433')) throw new Error('REFUSING: not the local test database');

const API = process.env.API || 'http://localhost:3001';
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
async function call(method, p, token, body) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const sql = new Client({ connectionString: env.DIRECT_URL });
const nairobi = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);

(async () => {
  await sql.connect();
  check('API ready', (await call('GET', '/ready')).status === 200);
  const admin = (await call('POST', '/platform-admin/auth/login', undefined, { email: 'admin@test.local', password: 'test-admin-password' })).json.accessToken;
  check('platform admin can sign in', Boolean(admin));
  const pa = (m, p, body) => call(m, `/platform-admin${p}`, admin, body);

  section('1. Settings');
  const s0 = await pa('GET', '/seasonal/settings');
  check('the default terms: 50% 15 Jan, 30% 15 May, 20% 15 Sep, 30 days grace; 10% off the whole year; KES 1,500 minimum', s0.status === 200 && s0.json.terms.map((t) => `${t.shareRate}@${t.dueMonth}/${t.dueDay}+${t.graceDays}`).join() === '0.5@1/15+30,0.3@5/15+30,0.2@9/15+30' && s0.json.payInFullDiscountRate === 0.1 && s0.json.minFirstPaymentKes === 1500, s0.json);
  check('terms whose shares do not add up to 100% are refused', (await pa('PATCH', '/seasonal/settings', { terms: s0.json.terms.map((t) => ({ ...t, shareRate: 0.3 })) })).status === 400);
  const s1 = await pa('PATCH', '/seasonal/settings', { minFirstPaymentKes: 1500, setupFeeKes: 0 });
  check('the platform admin saves the settings', s1.status === 200);
  check('a business cannot open the settings', (await call('GET', '/platform-admin/seasonal/settings')).status === 401);
  check('a seasonal plan needs an annual price', (await pa('POST', '/plans', { tier: 'SEASONAL', name: 'x', priceKes: 1, maxDevices: 1, maxBranches: 1, billingCycle: 'SEASONAL' })).status === 400);
  const plan = (await pa('GET', '/plans')).json.find((p) => p.tier === 'SEASONAL');
  check('the School Supplier plan exists, seasonal, with an annual price', plan && plan.billingCycle === 'SEASONAL' && Number(plan.annualPriceKes) > 0, plan);
  const annual = Number(plan.annualPriceKes);

  section('2. A school supplier signs up');
  const email = `seasonal-${tag}@demo.zaroda.pos`;
  const reg = await call('POST', '/auth/register', undefined, { organizationName: `Seasonal Supplies ${tag}`, industryType: 'SCHOOL_SUPPLIER', ownerFullName: 'Seasonal Owner', ownerEmail: email, ownerPassword: 'password123', branchName: 'Main' });
  check('signs up', reg.status === 201, reg.json);
  const owner = (await call('POST', '/auth/login', undefined, { email, password: 'password123' })).json.accessToken;
  const mine = await call('GET', '/subscription/seasonal', owner);
  const year = Number(nairobi().slice(0, 4));
  const month = Number(nairobi().slice(5, 7));
  const expectTerms = month <= 4 ? [1, 2, 3] : month <= 8 ? [2, 3] : month <= 10 ? [3] : [1, 2, 3];
  const expectYear = month >= 11 ? year + 1 : year;
  check('it is on the seasonal plan, with the rest of this school year (or next year from Nov-Dec), whole terms', mine.status === 200 && mine.json.cycle === 'SEASONAL' && mine.json.instalments.map((i) => `${i.schoolYear}T${i.term}`).join() === expectTerms.map((t) => `${expectYear}T${t}`).join(), mine.json.instalments);
  const shares = { 1: 0.5, 2: 0.3, 3: 0.2 };
  check('each term is its share of the annual price (the first at least KES 1,500)', mine.json.instalments.every((i, n) => i.amount === (n === 0 ? Math.max(1500, Math.round(annual * shares[i.term])) : Math.round(annual * shares[i.term]))), mine.json.instalments);
  check('nothing is due before today', mine.json.instalments.every((i) => i.dueDate >= nairobi()));
  check('not read-only yet', ['TRIAL', 'ACTIVE'].includes(mine.json.status), mine.json.status);
  const orgId = (await sql.query('SELECT "organizationId" AS o FROM subscription_instalments WHERE id = $1', [mine.json.instalments[0].id])).rows[0].o;
  const seen = (await call('GET', '/platform-admin/seasonal/businesses', admin)).json.find((b) => b.organizationId === orgId);
  check('the platform admin sees the business and its instalments', seen && seen.instalments.length === expectTerms.length, seen);

  section('3. Overdue: read-only');
  const first = mine.json.instalments[0];
  const shifted = await pa('POST', '/seasonal/shift-due-date', { schoolYear: first.schoolYear, term: first.term, dueDate: nairobi(-40), reason: `test ${tag}` });
  check('the platform admin moves a term\'s due date for every seasonal business at once', shifted.status === 200 && shifted.json.moved >= 1, shifted.json);
  const log = (await pa('GET', '/seasonal/settings')).json.shifts.find((x) => x.reason === `test ${tag}`);
  check('and it is logged: who, when, which term', log && log.platformAdminId && log.newDueDate === nairobi(-40) && log.instalments >= 1, log);
  const audited = (await sql.query("SELECT 1 FROM platform_audit_log WHERE action = 'platform_admin.seasonal_due_date_shifted' AND \"entityId\" = $1", [`${first.schoolYear}-T${first.term}`])).rowCount;
  check('and in the platform audit log', audited >= 1);
  const ro = await call('GET', '/subscription/seasonal', owner);
  check('40 days past due (30 days grace): READ_ONLY', ro.json.status === 'READ_ONLY' && ro.json.instalments[0].state === 'OVERDUE', ro.json.status);
  const blocked = await call('POST', '/expenses', owner, { spentOn: nairobi(), category: 'TRANSPORT', amount: 100 });
  check('a read-only business cannot change anything (new expense refused, with why)', blocked.status === 403 && /read-only/.test(blocked.json.message), blocked.json);
  const branches = await call('GET', '/branches', owner);
  check('but can still sign in and see its records', branches.status === 200 && (await call('POST', '/auth/login', undefined, { email, password: 'password123' })).status === 201);
  const payTry = await call('POST', `/subscription/seasonal/instalments/${first.id}/pay`, owner, { phone: '0712345678' });
  check('and can still try to pay (never blocked as read-only)', payTry.status !== 403, payTry);
  check('the whole year at the discount is only open in January', (await pa('POST', `/seasonal/organizations/${orgId}/instalments/${first.id}/payment`, { method: 'CASH', fullYear: true })).status === (month === 1 ? 200 : 400));

  section('4. Paid: open again at once');
  const paid = await pa('POST', `/seasonal/organizations/${orgId}/instalments/${first.id}/payment`, { method: 'MPESA', reference: `QX${tag}` });
  check('the platform admin records the payment', paid.status === 200 && paid.json.status !== 'READ_ONLY', paid.json);
  check('and the business can change things again straight away', (await call('POST', '/expenses', owner, { spentOn: nairobi(), category: 'TRANSPORT', amount: 100, description: `seasonal ${tag}` })).status === 201);
  check('an instalment cannot be paid twice', (await pa('POST', `/seasonal/organizations/${orgId}/instalments/${first.id}/payment`, { method: 'CASH' })).status === 409);
  const p1 = (await sql.query('SELECT commissionable FROM subscription_payments WHERE id = $1', [paid.json.payment.id])).rows[0];
  check('the first payment earns the sales team its commission', p1.commissionable === true);
  const second = mine.json.instalments[1];
  if (second) {
    const paid2 = await pa('POST', `/seasonal/organizations/${orgId}/instalments/${second.id}/payment`, { method: 'BANK' });
    const p2 = (await sql.query('SELECT commissionable FROM subscription_payments WHERE id = $1', [paid2.json.payment.id])).rows[0];
    check(`a later term that is not a January renewal does not (Term ${second.term})`, p2.commissionable === (second.term === 1), p2);
  }
  const after = (await call('GET', '/subscription/seasonal', owner)).json;
  check('My subscription shows it paid', after.instalments[0].state === 'PAID' && after.status !== 'READ_ONLY', after);
  check('a monthly plan cannot have a seasonal payment, and a seasonal one not a monthly payment', (await pa('POST', `/organizations/${orgId}/payments`, { amount: 100, method: 'CASH' })).status === 400);

  section('5. A monthly business is untouched');
  const demo = (await call('POST', '/auth/login', undefined, { email: 'owner@demo.zaroda.pos', password: 'password123' })).json.accessToken;
  const demoSub = await call('GET', '/subscription/seasonal', demo);
  check('the demo shop is still on its monthly plan', demoSub.status === 200 && demoSub.json.cycle === 'MONTHLY' && demoSub.json.instalments.length === 0, demoSub.json);
  const demoExp = await call('POST', '/expenses', demo, { spentOn: nairobi(), category: 'TRANSPORT', amount: 50, description: `seasonal ${tag}` });
  check('and can change things as before', demoExp.status === 201, demoExp.json);
  await sql.query(`DELETE FROM expenses WHERE description = $1`, [`seasonal ${tag}`]);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
