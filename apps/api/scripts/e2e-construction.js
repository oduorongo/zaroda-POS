// End-to-end test of Construction C1 against a LOCAL test setup: business-type gating, construction roles, the compliance vault
// (documents, private files, NCA registrations and caps), tax settings with effective dates, expiry alerts, plans (trial, quote,
// coupon, M-Pesa via the mock Tuma, user limit, read-only when suspended), the super-admin tools, tenant isolation and audit.
// Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and apply-rls, `npx ts-node prisma/seed-construction.ts`,
// scripts/mock-tuma.js, and the API with the test settings. API defaults to http://localhost:3001 (override with API=...).
//   node scripts/e2e-construction.js
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

const API = process.env.API || 'http://localhost:3001';
const TUMA = process.env.MOCK_TUMA || 'http://localhost:4010';
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
async function call(method, p, { token, body, headers, raw } = {}) {
  const response = await fetch(API + p, {
    method,
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const buf = Buffer.from(await response.arrayBuffer());
  let json = {};
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    /* binary */
  }
  return { status: response.status, json, buf, type: response.headers.get('content-type') };
}
const as = (token) => ({
  get: (p) => call('GET', p, { token }),
  post: (p, body) => call('POST', p, { token, body }),
  put: (p, body) => call('PUT', p, { token, body }),
  patch: (p, body) => call('PATCH', p, { token, body }),
  del: (p) => call('DELETE', p, { token }),
});
const login = async (email, password = 'password123') => (await call('POST', '/auth/login', { body: { email, password } })).json.accessToken;
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sql.connect();
  const org = (await sql.query(`SELECT id FROM organizations WHERE name = 'Uriri Builders Ltd' AND "industryType" = 'CONSTRUCTION'`)).rows[0];
  if (!org) throw new Error('Run prisma/seed-construction.ts first');
  const orgId = org.id;
  await sql.query('DELETE FROM con_alerts WHERE "organizationId" = $1', [orgId]);
  await sql.query(`UPDATE con_roles SET "approvalLimit" = 500000 WHERE "organizationId" = $1 AND code = 'CON_PROJECT_MGR'`, [orgId]);
  await sql.query(`UPDATE con_subscriptions SET "couponCode" = NULL, "couponMonthsLeft" = 0, addons = '{}', "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);
  await sql.query(`UPDATE org_users SET "isActive" = false WHERE "organizationId" = $1 AND "userId" IN (SELECT id FROM users WHERE email ~ '^(extra|fill|sixth|proc-|site-)')`, [orgId]);

  section('1. Signing in and who may use construction');
  const dir = as(await login('director@uriri.demo'));
  const comp = as(compToken);
  const qs = as(qsToken);
  const acc = as(await login('accounts@uriri.demo'));
  check('without a token construction answers 401', (await call('GET', '/construction/me')).status === 401);
  const me = await dir.get('/construction/me');
  check('director sees the Contractor plan, active', me.json.plan?.code === 'CON_CONTRACTOR' && me.json.status === 'ACTIVE', me.json);
  check('the owner acts as Director', me.json.isOwner === true && me.json.companyRoles.includes('CON_DIRECTOR'));
  const retail = await call('POST', '/auth/register', { body: { organizationName: `Retail ${tag}`, industryType: 'RETAIL', ownerFullName: 'R', ownerEmail: `retail-${tag}@test.local`, ownerPassword: 'password123', branchName: 'Main' } });
  check('a retail business is refused construction routes (403)', (await as(retail.json.accessToken).get('/construction/me')).status === 403);

  section('2. Dashboard and compliance health');
  const dash = await dir.get('/construction/dashboard');
  check('dashboard loads', dash.status === 200, dash.json);
  check('an expired business permit makes health CRITICAL', dash.json.compliance?.health === 'CRITICAL', dash.json.compliance);
  check('counts valid, expiring and expired', dash.json.compliance?.counts.expired >= 1 && dash.json.compliance?.counts.expiring >= 2, dash.json.compliance?.counts);

  section('3. Roles decide who may change the vault');
  check('QS can view documents', (await qs.get('/construction/compliance/docs')).status === 200);
  check('QS cannot add a document', (await qs.post('/construction/compliance/docs', { type: 'OTHER', title: 'x' })).status === 403);
  const doc = await comp.post('/construction/compliance/docs', { type: 'INSURANCE_PL', title: `Public liability ${tag}`, refNo: 'PL-1', issuedAt: '2026-01-01', expiresAt: '2027-01-01' });
  check('compliance officer adds a document', doc.status === 201, doc.json);
  check('it cannot expire before it was issued', (await comp.post('/construction/compliance/docs', { type: 'OTHER', title: 'bad', issuedAt: '2026-05-01', expiresAt: '2026-04-01' })).status === 400);

  section('4. Private files');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const up = await call('POST', `/construction/compliance/docs/${doc.json.id}/file`, { token: compToken, raw: pdf, headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('policy.pdf') } });
  check('a PDF uploads', up.status === 201 && up.json.hasFile === true, up.json);
  check('a file pretending to be a PDF is refused', (await call('POST', `/construction/compliance/docs/${doc.json.id}/file`, { token: compToken, raw: Buffer.from('hello'), headers: { 'Content-Type': 'application/pdf' } })).status === 400);
  check('other file types are refused', (await call('POST', `/construction/compliance/docs/${doc.json.id}/file`, { token: compToken, raw: Buffer.from('hello'), headers: { 'Content-Type': 'text/plain' } })).status === 400);
  const dl = await call('GET', `/construction/compliance/docs/${doc.json.id}/file`, { token: qsToken });
  check('a viewer downloads the same bytes through the API', dl.status === 200 && dl.buf.equals(pdf) && (dl.type ?? '').includes('pdf'), { status: dl.status, type: dl.type });
  const keyRow = (await sql.query('SELECT "fileKey" FROM con_compliance_docs WHERE id = $1', [doc.json.id])).rows[0];
  check('the stored key is private (no public URL saved)', keyRow.fileKey.startsWith(`construction/${orgId}/`) && !keyRow.fileKey.startsWith('http'));
  const upd = await comp.put(`/construction/compliance/docs/${doc.json.id}`, { type: 'INSURANCE_PL', title: `Public liability ${tag}`, refNo: 'PL-2', issuedAt: '2026-01-01', expiresAt: '2026-11-15' });
  check('renewing/editing a document recalculates its badge', upd.status === 200 && upd.json.state === 'EXPIRING', upd.json);

  section('5. NCA registrations and caps');
  const regs = await dir.get('/construction/compliance/registrations');
  check('two registrations seeded (NCA5 Building, NCA6 Roads)', regs.json.length === 2 && regs.json.some((r) => r.worksClass === 'BUILDING' && r.ncaCategory === 5));
  check('a 90M building job fits NCA5', (await qs.get('/construction/compliance/cap-check?worksClass=BUILDING&value=90000000')).json.ok === true);
  const over = await qs.get('/construction/compliance/cap-check?worksClass=BUILDING&value=120000000');
  check('a 120M building job is over the NCA5 cap, with the reason', over.json.ok === false && /NCA5/.test(over.json.reason), over.json);
  check('no registration for electrical work = blocked', (await qs.get('/construction/compliance/cap-check?worksClass=ELEC_MECH&value=1000')).json.ok === false);
  const limits = await dir.get('/construction/compliance/limits');
  check('24 caps seeded (3 classes x 8 categories)', limits.json.length === 24);
  const b5 = limits.json.find((l) => l.worksClass === 'BUILDING' && l.ncaCategory === 5);
  check('NCA5 building cap is 100M', b5?.maxValue === 100000000, b5);
  check('compliance officer edits a cap', (await comp.patch(`/construction/compliance/limits/${b5.id}`, { maxValue: 150000000 })).json.maxValue === 150000000);
  check('...so 120M now fits', (await qs.get('/construction/compliance/cap-check?worksClass=BUILDING&value=120000000')).json.ok === true);
  check('QS cannot edit caps', (await qs.patch(`/construction/compliance/limits/${b5.id}`, { maxValue: 1 })).status === 403);
  await comp.patch(`/construction/compliance/limits/${b5.id}`, { maxValue: 100000000 });

  section('6. Tax settings with effective dates');
  const tax = await qs.get('/construction/settings/tax');
  const vat = tax.json.find((t) => t.key === 'VAT' && t.current);
  check('VAT 16% is current', vat?.rate === 16, vat);
  check('NCA levy is seeded switched off', tax.json.some((t) => t.key === 'NCA_LEVY' && t.active === false));
  check('QS cannot change rates', (await qs.post('/construction/settings/tax', { key: 'VAT', rate: 17, effectiveFrom: '2099-01-01' })).status === 403);
  const future = `2099-0${1 + (Date.now() % 9)}-01`;
  const added = await acc.post('/construction/settings/tax', { key: 'VAT', rate: 17, effectiveFrom: future });
  check('accountant adds a future VAT rate', added.status === 201, added.json);
  const after = await qs.get('/construction/settings/tax');
  check('the future rate is upcoming and 16% stays current', after.json.some((t) => t.key === 'VAT' && t.rate === 17 && t.upcoming) && after.json.find((t) => t.key === 'VAT' && t.current)?.rate === 16);
  check('two rates for the same day are refused', (await acc.post('/construction/settings/tax', { key: 'VAT', rate: 18, effectiveFrom: future })).status === 400);

  section('7. Roles, approval limits and staff');
  const roles = await qs.get('/construction/roles');
  check('all 17 roles are seeded', roles.json.length === 17, roles.json.length);
  check('PM approves up to 500,000 by default', roles.json.find((r) => r.code === 'CON_PROJECT_MGR')?.approvalLimit === 500000);
  check('director changes an approval limit', (await dir.patch('/construction/roles/CON_PROJECT_MGR', { approvalLimit: 750000 })).json.approvalLimit === 750000);
  check('QS cannot', (await qs.patch('/construction/roles/CON_PROJECT_MGR', { approvalLimit: 1 })).status === 403);
  const staff = await dir.get('/construction/staff');
  check('director lists staff with their roles', staff.json.length >= 4 && staff.json.some((s) => s.roles.includes('CON_QS')));
  check('only the director may list staff', (await qs.get('/construction/staff')).status === 403);
  const qsRow = staff.json.find((s) => s.email === 'qs@uriri.demo');
  check('director gives the QS procurement too', (await dir.put(`/construction/staff/${qsRow.orgUserId}/roles`, { roles: ['CON_QS', 'CON_PROCUREMENT'] })).status === 200);
  check('a project role cannot be given company-wide', (await dir.put(`/construction/staff/${qsRow.orgUserId}/roles`, { roles: ['CON_SITE_ENGINEER'] })).status === 400);
  await dir.put(`/construction/staff/${qsRow.orgUserId}/roles`, { roles: ['CON_QS'] });
  const addedStaff = await dir.post('/construction/staff', { email: `proc-${tag}@uriri.demo`, fullName: 'Procurement Person', password: 'password123', job: 'CON_PROCUREMENT' });
  check('director adds a person by their job (office access + the role)', addedStaff.status === 201 && addedStaff.json.role === 'MANAGER' && addedStaff.json.job === 'CON_PROCUREMENT', addedStaff.json);
  const site = await dir.post('/construction/staff', { email: `site-${tag}@uriri.demo`, fullName: 'Site Person', password: 'password123', job: 'SITE' });
  check('site staff get site access', site.json.role === 'SUPERVISOR' && site.json.job === null, site.json);
  check('a cashier cannot be added to a construction business', (await dir.post('/org-users', { email: `cashier-${tag}@uriri.demo`, fullName: 'C', password: 'password123', role: 'CASHIER' })).status === 400);
  check('nor can someone be changed to cashier', (await dir.patch(`/org-users/${site.json.orgUserId}`, { role: 'CASHIER' })).status === 400);
  check('a made-up job is refused', (await dir.post('/construction/staff', { email: `x-${tag}@uriri.demo`, job: 'CON_CLIENT' })).status === 400);
  await sql.query('UPDATE org_users SET "isActive" = false WHERE id = ANY($1)', [[addedStaff.json.orgUserId, site.json.orgUserId]]);

  section('8. Expiry alerts (60/30/7 days, once each)');
  const admin = as((await call('POST', '/platform-admin/auth/login', { body: { email: 'admin@test.local', password: 'test-admin-password' } })).json.accessToken);
  const run1 = await admin.post('/platform-admin/construction/alerts/run', {});
  check('the alert pass raises alerts', run1.status === 201 && run1.json.raised >= 3, run1.json);
  const run2 = await admin.post('/platform-admin/construction/alerts/run', {});
  check('running again raises nothing new', run2.json.raised === 0, run2.json);
  const alerts = await dir.get('/construction/alerts');
  check('alerts show in-app, the expired permit included', alerts.json.some((a) => a.kind === 'EXPIRED') && alerts.json.some((a) => /expires in 30 days/.test(a.title)), alerts.json.map((a) => a.title));
  check('mark all read', (await dir.post('/construction/alerts/read', {})).json.updated >= 3);

  section('9. Plans, quotes and coupons');
  const plan = await dir.get('/construction/plan');
  check('plan screen shows five plans and usage', plan.json.plans?.length === 5 && plan.json.usage.users >= 4, plan.json.usage);
  check('Contractor monthly quote is 9,500', (await dir.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=MONTHLY')).json.amount === 9500);
  check('annual is 12 months for 95,000', (await dir.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=ANNUAL')).json.amount === 95000);
  check('PILOT50 halves the first month', (await dir.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=MONTHLY&couponCode=PILOT50')).json.amount === 4750);
  check('an extra project adds 1,500/month', (await dir.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=MONTHLY&extraProjects=1')).json.amount === 11000);
  check('a made-up coupon is refused', (await dir.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=MONTHLY&couponCode=NOPE')).status === 400);
  check('Mjengo is 1,500 a month', (await dir.get('/construction/plan/quote?planCode=CON_MJENGO&cycle=MONTHLY')).json.amount === 1500);
  check('...or 15,000 a year', (await dir.get('/construction/plan/quote?planCode=CON_MJENGO&cycle=ANNUAL')).json.amount === 15000);
  const mjExtra = await dir.get('/construction/plan/quote?planCode=CON_MJENGO&cycle=MONTHLY&extraProjects=1');
  check('Mjengo sells no extra projects - it points to Fundi', mjExtra.status === 400 && /Upgrade to Fundi/.test(mjExtra.json.message), mjExtra.json);
  check('Enterprise cannot be paid online (quote)', (await dir.get('/construction/plan/quote?planCode=CON_ENTERPRISE&cycle=MONTHLY')).status === 400);
  check('QS cannot pay', (await qs.post('/construction/plan/pay', { planCode: 'CON_CONTRACTOR', cycle: 'MONTHLY', phone: '0712345678' })).status === 403);
  check('cannot drop to Fundi with more staff than it allows', (await (async () => {
    for (let i = 0; i < 2; i++) await sql.query(`INSERT INTO users (id, email, "passwordHash", "fullName", "updatedAt") VALUES (gen_random_uuid()::text, $1, 'x', 'Extra', now()) ON CONFLICT DO NOTHING`, [`extra${i}-${tag}@uriri.demo`]);
    const users = (await sql.query(`SELECT id FROM users WHERE email LIKE $1`, [`extra%-${tag}@uriri.demo`])).rows;
    for (const u of users) await sql.query(`INSERT INTO org_users (id, "organizationId", "userId", role) VALUES (gen_random_uuid()::text, $1, $2, 'MANAGER')`, [orgId, u.id]);
    return (await acc.post('/construction/plan/pay', { planCode: 'CON_FUNDI', cycle: 'MONTHLY', phone: '0712345678' })).status;
  })()) === 400);
  await sql.query(`DELETE FROM org_users WHERE "userId" IN (SELECT id FROM users WHERE email LIKE $1)`, [`extra%-${tag}@uriri.demo`]);

  section('10. Paying by M-Pesa (mock Tuma)');
  const before = (await sql.query('SELECT "currentPeriodEnd", "couponCode", "couponMonthsLeft" FROM con_subscriptions WHERE "organizationId" = $1', [orgId])).rows[0];
  const pay = await acc.post('/construction/plan/pay', { planCode: 'CON_CONTRACTOR', cycle: 'MONTHLY', phone: '0712345678', couponCode: before.couponCode ? undefined : 'PILOT50' });
  check('accountant starts an M-Pesa payment', pay.status === 201 && pay.json.status === 'PENDING', pay.json);
  check('a second prompt within a minute is refused', (await acc.post('/construction/plan/pay', { planCode: 'CON_CONTRACTOR', cycle: 'MONTHLY', phone: '0712345678' })).status === 400);
  const mrid = (await sql.query('SELECT "tumaMerchantRequestId" FROM con_subscription_payments WHERE id = $1', [pay.json.id])).rows[0]?.tumaMerchantRequestId;
  const paid = await fetch(`${TUMA}/_test/pay/${mrid}`, { method: 'POST' }).then((r) => r.json()).catch(() => ({}));
  check('mock Tuma calls back', paid.callbackAnsweredWith === 200, paid);
  await sleep(300);
  const settled = (await sql.query('SELECT status, receipt, "periodEndAfter" FROM con_subscription_payments WHERE id = $1', [pay.json.id])).rows[0];
  check('the payment is PAID with the M-Pesa receipt', settled.status === 'PAID' && !!settled.receipt, settled);
  const subAfter = (await sql.query('SELECT "currentPeriodEnd", status, "couponCode", "couponMonthsLeft", "paidPaymentsCount" FROM con_subscriptions WHERE "organizationId" = $1', [orgId])).rows[0];
  check('the plan is extended by a month', Math.round((subAfter.currentPeriodEnd - before.currentPeriodEnd) / 86400000) >= 28, { before: before.currentPeriodEnd, after: subAfter.currentPeriodEnd });
  check('the coupon is kept with one month left', subAfter.couponCode === 'PILOT50' && subAfter.couponMonthsLeft === (before.couponCode ? Math.max(before.couponMonthsLeft - 1, 0) : 1), subAfter);
  check('a repeated callback changes nothing', await (async () => {
    await fetch(`${TUMA}/_test/pay/${mrid}`, { method: 'POST' });
    await sleep(300);
    const again = (await sql.query('SELECT "currentPeriodEnd", "paidPaymentsCount" FROM con_subscriptions WHERE "organizationId" = $1', [orgId])).rows[0];
    return again.paidPaymentsCount === subAfter.paidPaymentsCount && +again.currentPeriodEnd === +subAfter.currentPeriodEnd;
  })());

  section('11. User limit and read-only');
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_FUNDI' WHERE "organizationId" = $1`, [orgId]);
  const users = Number((await sql.query('SELECT count(*) FROM org_users WHERE "organizationId" = $1 AND "isActive"', [orgId])).rows[0].count);
  const fill = [];
  for (let i = users; i < 5; i++) fill.push(await dir.post('/org-users', { email: `fill${i}-${tag}@uriri.demo`, fullName: 'Fill', password: 'password123', role: 'MANAGER' }));
  check('staff can be added up to the Fundi limit of 5', fill.every((r) => r.status === 201), fill.map((r) => r.json));
  const sixth = await dir.post('/org-users', { email: `sixth-${tag}@uriri.demo`, fullName: 'Six', password: 'password123', role: 'MANAGER' });
  check('the 6th is refused with an upgrade prompt (402)', sixth.status === 402 && sixth.json.upgrade === true && /Upgrade/.test(sixth.json.message), sixth.json);
  await sql.query(`UPDATE org_users SET "isActive" = false WHERE "userId" IN (SELECT id FROM users WHERE email LIKE $1)`, [`fill%-${tag}@uriri.demo`]);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR', "currentPeriodEnd" = now() - interval '30 days' WHERE "organizationId" = $1`, [orgId]);
  check('a lapsed plan shows SUSPENDED', (await dir.get('/construction/me')).json.status === 'SUSPENDED');
  const ro = await comp.post('/construction/compliance/docs', { type: 'OTHER', title: 'while suspended' });
  check('...and is read-only: changes refused (402)', ro.status === 402 && ro.json.readOnly === true, ro.json);
  check('...but reading still works', (await comp.get('/construction/compliance/docs')).status === 200);
  check('...and paying is still allowed', (await acc.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=MONTHLY')).status === 200);
  await sql.query(`UPDATE con_subscriptions SET "currentPeriodEnd" = $2 WHERE "organizationId" = $1`, [orgId, subAfter.currentPeriodEnd]);

  section('12. A new construction signup');
  const signup = await call('POST', '/auth/register', { body: { organizationName: `Builder ${tag}`, industryType: 'CONSTRUCTION', ownerFullName: 'New Owner', ownerEmail: `builder-${tag}@test.local`, ownerPassword: 'password123', branchName: 'Head Office' } });
  check('signup as CONSTRUCTION works', signup.status === 201, signup.json);
  const fresh = as(signup.json.accessToken);
  const freshMe = await fresh.get('/construction/me');
  check('it starts on a 14-day Contractor trial', freshMe.json.status === 'TRIAL' && freshMe.json.plan.code === 'CON_CONTRACTOR', freshMe.json);
  const freshPlan = await fresh.get('/construction/plan');
  check('trial ends in 14 days', freshPlan.json.daysLeft === 14, freshPlan.json.daysLeft);
  check('no POS device subscription was made', Number((await sql.query('SELECT count(*) FROM subscriptions WHERE "organizationId" = $1', [signup.json.organizationId])).rows[0].count) === 0);
  check('roles, caps and taxes are seeded for it', (await fresh.get('/construction/roles')).json.length === 17 && (await fresh.get('/construction/compliance/limits')).json.length === 24 && (await fresh.get('/construction/settings/tax')).json.length === 9);

  section('13. Tenant isolation');
  check("a new business sees none of Uriri's documents", (await fresh.get('/construction/compliance/docs')).json.length === 0);
  check("and cannot fetch Uriri's file", (await call('GET', `/construction/compliance/docs/${doc.json.id}/file`, { token: signup.json.accessToken })).status === 404);
  check("or edit Uriri's document", (await fresh.put(`/construction/compliance/docs/${doc.json.id}`, { type: 'OTHER', title: 'hijack' })).status === 404);

  section('14. Super-admin');
  const tenants = await admin.get('/platform-admin/construction/tenants');
  const uriri = tenants.json.tenants?.find((t) => t.id === orgId);
  check('tenants list shows Uriri paying, with MRR', uriri?.status === 'ACTIVE' && uriri.mrr === 9500 && tenants.json.mrr >= 9500, uriri);
  const ext = await admin.post(`/platform-admin/construction/tenants/${signup.json.organizationId}/extend-trial`, { days: 7 });
  check('trial extended by 7 days', ext.status === 201 && Math.round((new Date(ext.json.currentPeriodEnd) - Date.now()) / 86400000) >= 20, ext.json);
  check("a paid business's trial cannot be extended", (await admin.post(`/platform-admin/construction/tenants/${orgId}/extend-trial`, { days: 7 })).status === 409);
  const edited = await admin.patch('/platform-admin/construction/plans/CON_FUNDI', { monthlyPrice: 3600 });
  check('super-admin edits a plan price', Number(edited.json.monthlyPrice) === 3600, edited.json);
  await admin.patch('/platform-admin/construction/plans/CON_FUNDI', { monthlyPrice: 3500 });
  const pub = await call('GET', '/public/construction/plans');
  check('public pricing lists the plans', pub.status === 200 && pub.json.plans.length === 5 && pub.json.plans[0].code === 'CON_MJENGO' && pub.json.plans[0].setupFee === 3000 && pub.json.trialDays === 14);
  const rec = await admin.post(`/platform-admin/construction/tenants/${signup.json.organizationId}/payments`, { planCode: 'CON_FUNDI', cycle: 'ANNUAL', amount: 35000, method: 'BANK', reference: `BANK-${tag}` });
  check('a bank payment recorded by ZARODA activates the plan for a year', rec.json.status === 'PAID' && (await fresh.get('/construction/me')).json.status === 'ACTIVE', rec.json);

  section('15. Audit log');
  const audit = (await sql.query(`SELECT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'con_%'`, [orgId])).rows.map((r) => r.action);
  for (const a of ['con_doc.created', 'con_doc.updated', 'con_doc.file_uploaded', 'con_category_limit.updated', 'con_tax_setting.created', 'con_role.limit_updated', 'con_user_roles.set', 'con_payment.started', 'con_subscription.paid']) {
    check(`audit: ${a}`, audit.includes(a));
  }
  const auditRow = (await sql.query(`SELECT before, after, "actorId" FROM audit_log WHERE "organizationId" = $1 AND action = 'con_doc.updated' ORDER BY "createdAt" DESC LIMIT 1`, [orgId])).rows[0];
  check('audit keeps who, before and after', !!auditRow.actorId && auditRow.before?.refNo === 'PL-1' && auditRow.after?.refNo === 'PL-2');

  await comp.del(`/construction/compliance/docs/${doc.json.id}`);
  await sql.end();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

let compToken;
let qsToken;
(async () => {
  compToken = await login('compliance@uriri.demo');
  qsToken = await login('qs@uriri.demo');
  await main();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
