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
  _token: token,
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
const randomUUIDish = () => require('crypto').randomUUID();
const nairobi = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const t0 = Date.now();

async function main() {
  await sql.connect();
  const org = (await sql.query(`SELECT id FROM organizations WHERE name = 'Uriri Builders Ltd' AND "industryType" = 'CONSTRUCTION'`)).rows[0];
  if (!org) throw new Error('Run prisma/seed-construction.ts first');
  const orgId = org.id;
  await sql.query('DELETE FROM con_alerts WHERE "organizationId" = $1', [orgId]);
  await sql.query(`DELETE FROM con_project_members WHERE "orgUserId" IN (SELECT ou.id FROM org_users ou JOIN users u ON u.id = ou."userId" WHERE u.email = 'qs@uriri.demo')`);
  await sql.query(`DELETE FROM con_tax_settings WHERE "organizationId" = $1 AND "effectiveFrom" > '2090-01-01'`, [orgId]);
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

  section('13b. Projects, tenders, permits, BQ, programme (C2)');
  const { Workbook } = require(require.resolve('exceljs', { paths: [API_DIR] }));
  const seeded = (await dir.get('/construction/projects')).json.find((p) => p.name === 'Uriri Day Secondary Classrooms');
  check('the seeded project is listed, active, BQ equal to the contract sum', seeded?.status === 'ACTIVE' && seeded.bqTotal === seeded.contractSum && seeded.contractSum === 10713000, seeded);
  const detail = (await dir.get(`/construction/projects/${seeded.id}`)).json;
  check('it has 6 permits, 3 consultants and at least 2 team members', detail.permits?.length === 6 && detail.parties.length >= 3 && detail.members.length >= 2, { p: detail.permits?.length, parties: detail.parties?.length, m: detail.members?.length });
  const seededBq = (await qs.get(`/construction/projects/${seeded.id}/bq`)).json;
  check('its BQ has 7 sections and 30 items, no difference', seededBq.sections.length === 7 && seededBq.sections.reduce((a, s) => a + s.items.length, 0) === 30 && seededBq.difference === 0);
  check('programme progress is worked out from milestones', seeded.progress > 0 && seeded.progress < 100, seeded.progress);
  check('three tenders are seeded', (await qs.get('/construction/tenders')).json.length >= 3);

  const okTender = await qs.post('/construction/tenders', { title: `Ward block ${tag}`, procuringEntity: `Clinic ${tag}`, worksClass: 'BUILDING', estValue: 40000000, closingAt: new Date(Date.now() + 10 * 86400000).toISOString() });
  check('QS adds a tender within the NCA5 cap', okTender.status === 201 && !okTender.json.capOverrideReason, okTender.json);
  const big = { title: `Hospital ${tag}`, procuringEntity: 'County Government', worksClass: 'BUILDING', estValue: 150000000 };
  const blocked = await qs.post('/construction/tenders', big);
  check('a 150M building tender is blocked above the NCA5 cap', blocked.status === 400 && blocked.json.capExceeded === true && /NCA5/.test(blocked.json.message), blocked.json);
  check('a QS cannot override the cap', (await qs.post('/construction/tenders', { ...big, overrideReason: 'Joint venture partner holds NCA1' })).status === 403);
  const overridden = await dir.post('/construction/tenders', { ...big, overrideReason: 'Joint venture partner holds NCA1' });
  check('the Director overrides with a reason, which is kept', overridden.status === 201 && overridden.json.capOverrideReason === 'Joint venture partner holds NCA1', overridden.json);
  const submit = async (id) => {
    let r = await qs.post(`/construction/tenders/${id}/outcome`, { status: 'SUBMITTED' });
    if (r.status === 409) r = await qs.post(`/construction/tenders/${id}/outcome`, { status: 'SUBMITTED', confirm: true });
    return r;
  };
  check('the tender is submitted', (await submit(okTender.json.id)).json.status === 'SUBMITTED');
  check('a submitted tender cannot be edited', (await qs.put(`/construction/tenders/${okTender.json.id}`, { title: 'x2', procuringEntity: 'y2', worksClass: 'BUILDING', estValue: 1 })).status === 409);
  const won = await qs.post(`/construction/tenders/${okTender.json.id}/outcome`, { status: 'WON', awardedSum: 39500000 });
  check('won: a project is created from it', won.status === 200 && won.json.status === 'WON' && !!won.json.project?.id, won.json);
  const pid = won.json.project.id;
  const np = (await dir.get(`/construction/projects/${pid}`)).json;
  check('the new project is PLANNING with the awarded sum, the client and 6 permits to do', np.status === 'PLANNING' && np.contractSum === 39500000 && np.client?.name === `Clinic ${tag}` && np.permits.every((x) => x.status === 'PENDING'), np);
  check('a won tender cannot be marked lost', (await qs.post(`/construction/tenders/${okTender.json.id}/outcome`, { status: 'LOST' })).status === 400);

  const active1 = await dir.post(`/construction/projects/${pid}/status`, { status: 'ACTIVE' });
  check('going Active without the NCA project registration is blocked', active1.status === 400 && active1.json.blocks?.length === 1, active1.json);
  check('only the Director changes the rule', (await qs.patch('/construction/settings/rules', { ncaProjectRegRule: 'WARN' })).status === 403);
  await dir.patch('/construction/settings/rules', { ncaProjectRegRule: 'WARN' });
  const active2 = await dir.post(`/construction/projects/${pid}/status`, { status: 'ACTIVE' });
  check('set to warn: it asks to confirm, listing what is missing (BQ, permits)', active2.status === 409 && active2.json.needsConfirm && active2.json.warnings.some((w) => /BQ totals/.test(w)) && active2.json.warnings.some((w) => /NCA project/.test(w)), active2.json);
  await dir.patch('/construction/settings/rules', { ncaProjectRegRule: 'BLOCK' });
  check('a project cannot skip ahead', (await dir.post(`/construction/projects/${pid}/status`, { status: 'DLP' })).status === 400);

  const permit = await comp.put(`/construction/projects/${pid}/permits/NCA_PROJECT_REG`, { status: 'APPROVED', refNo: `NCA/PR/${tag}`, issuedAt: '2026-10-01', expiresAt: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
  check('the compliance officer records the NCA project registration', permit.status === 200 && permit.json.status === 'APPROVED', permit.json);
  const permitPdf = Buffer.from('%PDF-1.4\n%%EOF\n');
  const pup = await call('POST', `/construction/projects/${pid}/permits/NCA_PROJECT_REG/file`, { token: compToken, raw: permitPdf, headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'nca.pdf' } });
  check('a permit file uploads', pup.status === 201, pup.json);
  check('and is downloaded through the API', (await call('GET', `/construction/projects/${pid}/permits/NCA_PROJECT_REG/file`, { token: qsToken })).buf.equals(permitPdf));
  check('a QS cannot record permits', (await qs.put(`/construction/projects/${pid}/permits/BUILDING_PERMIT`, { status: 'APPROVED' })).status === 403);
  const active3 = await dir.post(`/construction/projects/${pid}/status`, { status: 'ACTIVE', confirm: true });
  check('with the registration, it goes Active after confirming the warnings', active3.status === 200 && active3.json.status === 'ACTIVE', active3.json);

  const people = (await qs.get('/construction/people')).json;
  const siteGuy = people.find((x) => x.fullName === 'Fredrick Ouma');
  const qsGuy = people.find((x) => x.fullName === 'Caroline Wanjiku');
  check('people list has names but no emails', !!siteGuy && people.every((x) => !('email' in x)));
  const noCard = await dir.post(`/construction/projects/${pid}/members`, { orgUserId: qsGuy.orgUserId, role: 'CON_SITE_SUPERVISOR' });
  check('a Site Supervisor needs an NCA card', noCard.status === 400 && /accreditation/.test(noCard.json.message), noCard.json);
  await comp.put(`/construction/staff/${qsGuy.orgUserId}/accreditation`, { cardNo: `NCA/SS/${tag}`, expiresAt: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
  check('an expired card is refused', (await dir.post(`/construction/projects/${pid}/members`, { orgUserId: qsGuy.orgUserId, role: 'CON_SITE_SUPERVISOR' })).status === 400);
  await comp.put(`/construction/staff/${qsGuy.orgUserId}/accreditation`, { cardNo: `NCA/SS/${tag}`, expiresAt: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) });
  const soon = await dir.post(`/construction/projects/${pid}/members`, { orgUserId: qsGuy.orgUserId, role: 'CON_SITE_SUPERVISOR' });
  check('a card expiring within 30 days is allowed with a warning', soon.status === 201 && /expires in 1\d days|expires in \d days/.test(soon.json.warning ?? ''), soon.json);
  check('a project role is only for project roles', (await dir.post(`/construction/projects/${pid}/members`, { orgUserId: qsGuy.orgUserId, role: 'CON_QS' })).status === 400);

  const wait = 62000 - (Date.now() - t0) % 62000;
  if (Date.now() - t0 < 62000) await sleep(wait);
  const siteUser = as(await login('site@uriri.demo'));
  const siteList = (await siteUser.get('/construction/projects')).json;
  check('site staff see only the projects they are on', Array.isArray(siteList) && siteList.length === 1 && siteList[0].id === seeded.id, siteList);
  check("and cannot open another project", (await siteUser.get(`/construction/projects/${pid}`)).status === 403);
  check('site staff cannot see tenders', (await siteUser.get('/construction/tenders')).status === 403);
  check('the site supervisor can read the BQ of their project', (await siteUser.get(`/construction/projects/${seeded.id}/bq`)).status === 200);
  check('but cannot change it', (await siteUser.post(`/construction/projects/${seeded.id}/bq/sections`, { name: 'x' })).status === 403);

  const makeXlsx = async (rows) => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Bill 1');
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const upload = (buf, save) => call('POST', `/construction/projects/${pid}/bq/import${save ? '?save=true' : ''}`, { token: qsToken, raw: buf, headers: { 'Content-Type': xlsxType, 'X-File-Name': 'bq.xlsx' } });
  const bad = await makeXlsx([['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'], [null, 'PRELIMINARIES'], ['A', 'Site office', 'Item', null, null, 500000], ['B', 'Fencing', null, 100, 900, 90000]]);
  const badCheck = await upload(bad, false);
  check('a BQ with a bad row previews with the error and saves nothing', badCheck.status === 200 && badCheck.json.errors.length === 1 && badCheck.json.saved === false, badCheck.json);
  check('saving it is refused', (await upload(bad, true)).status === 400);
  const rows = [['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'], [null, 'BILL 1 - PRELIMINARIES'], ['A', 'Site office', 'Item', null, null, 500000], [null, 'BILL 2 - WORKS']];
  for (let i = 0; i < 20; i++) rows.push([String.fromCharCode(65 + i), `Work item ${i + 1}`, 'm²', 100, 19500, { formula: `D${rows.length + 1}*E${rows.length + 1}`, result: 1950000 }]);
  const good = await makeXlsx(rows);
  const preview = await upload(good, false);
  check('a good BQ previews: 2 sections, 21 items, 39.5M, matching', preview.json.itemCount === 21 && preview.json.sections.length === 2 && preview.json.total === 39500000 && preview.json.difference === 0, preview.json);
  check('nothing is saved by the preview', (await qs.get(`/construction/projects/${pid}/bq`)).json.sections.length === 0);
  check('saving imports it', (await upload(good, true)).json.saved === true);
  const imported = (await qs.get(`/construction/projects/${pid}/bq`)).json;
  check('the BQ now holds 21 items and matches the contract sum', imported.sections.reduce((a, s) => a + s.items.length, 0) === 21 && imported.difference === 0);
  const sec = (await qs.post(`/construction/projects/${pid}/bq/sections`, { name: 'BILL 3 - EXTRAS' })).json;
  const it = await qs.post(`/construction/projects/${pid}/bq/items`, { sectionId: sec.id, description: 'Extra paving', unit: 'm²', qty: 12.5, rate: 1200 });
  check('a BQ item added by hand is qty x rate', Number(it.json.amount) === 15000, it.json);
  check('and now shows a 15,000 difference', (await qs.get(`/construction/projects/${pid}/bq`)).json.difference === 15000);
  await qs.put(`/construction/projects/${pid}/bq/items/${it.json.id}`, { sectionId: sec.id, description: 'Extra paving', unit: 'm²', qty: 10, rate: 1200 });
  check('editing recalculates', (await qs.get(`/construction/projects/${pid}/bq`)).json.difference === 12000);
  await qs.del(`/construction/projects/${pid}/bq/sections/${sec.id}`);
  check('deleting the section removes its items', (await qs.get(`/construction/projects/${pid}/bq`)).json.difference === 0);
  check('an item cannot be put in another project\'s section', (await qs.post(`/construction/projects/${pid}/bq/items`, { sectionId: seededBq.sections[0].id, description: 'x', unit: 'm', qty: 1, rate: 1 })).status === 404);

  const m1 = await dir.post(`/construction/projects/${pid}/milestones`, { name: 'Substructure', startDate: '2026-11-01', endDate: '2026-11-30', percentComplete: 50 });
  check('a milestone is added', m1.status === 201, m1.json);
  check('one cannot end before it starts', (await dir.post(`/construction/projects/${pid}/milestones`, { name: 'Bad', startDate: '2026-12-10', endDate: '2026-12-01' })).status === 400);
  await dir.put(`/construction/projects/${pid}/milestones/${m1.json.id}`, { name: 'Substructure', startDate: '2026-11-01', endDate: '2026-11-30', percentComplete: 100 });
  check('progress follows the milestones', (await dir.get(`/construction/projects/${pid}`)).json.progress === 100);

  await admin.post('/platform-admin/construction/alerts/run', {});
  check('a permit expiring in 20 days raises an alert', (await dir.get('/construction/alerts')).json.some((a) => a.title.includes('NCA project registration') && /expires in 30 days/.test(a.title)));

  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_MJENGO' WHERE "organizationId" = $1`, [orgId]);
  const mj = await qs.post('/construction/projects', { name: `Third ${tag}`, worksClass: 'BUILDING', contractSum: 1000000 });
  check('on Mjengo a further project asks to upgrade to Fundi, no extra-project offer', mj.status === 402 && /Upgrade to Fundi/.test(mj.json.message) && !/extra project/.test(mj.json.message), mj.json);
  const mjT = await qs.get('/construction/tenders');
  check('Mjengo has no tenders register (upgrade prompt)', mjT.status === 402 && mjT.json.feature === 'tenders', mjT.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);
  const usageBefore = (await dir.get('/construction/plan')).json.usage.activeProjects;
  const closeMe = await qs.post('/construction/projects', { name: `Cancelled ${tag}`, worksClass: 'BUILDING', contractSum: 1000000 });
  check('a project gets the next code', /^PRJ-\d{3}$/.test(closeMe.json.code), closeMe.json);
  await dir.post(`/construction/projects/${closeMe.json.id}/status`, { status: 'CLOSED' });
  check('closed projects do not count toward the limit', (await dir.get('/construction/plan')).json.usage.activeProjects === usageBefore);
  check('a closed project cannot be edited', (await dir.put(`/construction/projects/${closeMe.json.id}`, { name: 'Renamed', worksClass: 'BUILDING', contractSum: 1 })).status === 409);

  check("another business cannot open Uriri's project", (await fresh.get(`/construction/projects/${seeded.id}`)).status === 404);
  check("or its BQ", (await fresh.get(`/construction/projects/${seeded.id}/bq`)).status === 404);
  const c2audit = (await sql.query(`SELECT DISTINCT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'con_%'`, [orgId])).rows.map((r) => r.action);
  for (const a of ['con_tender.created', 'con_tender.status_changed', 'con_project.created', 'con_project.status_changed', 'con_permit.updated', 'con_permit.file_uploaded', 'con_project_member.added', 'con_accreditation.saved', 'con_bq.imported', 'con_bq_item.created', 'con_bq_item.updated', 'con_bq_section.deleted', 'con_milestone.created', 'con_settings.updated']) {
    check(`audit: ${a}`, c2audit.includes(a));
  }
  await sql.query('UPDATE con_projects SET status = $2 WHERE id = $1', [pid, 'CLOSED']);
  await sql.query('DELETE FROM con_staff_accreditations WHERE "orgUserId" = $1', [qsGuy.orgUserId]);
  await sql.query('DELETE FROM con_project_members WHERE "orgUserId" = $1 AND "projectId" = $2', [qsGuy.orgUserId, pid]);

  section('13c. Site diary, photos, workers, muster, safety (C3)');
  const sid = seeded.id;
  const seededWorkers = (await siteUser.get(`/construction/workers?projectId=${sid}`)).json;
  check('15 workers are seeded on the project', Array.isArray(seededWorkers) && seededWorkers.filter((w) => w.name !== 'x').length >= 15, seededWorkers.length);
  check('lists mask ID numbers and phones', seededWorkers.every((w) => !w.idNo || /^\*+\d{4}$/.test(w.idNo)) && seededWorkers.every((w) => !w.phone || w.phone.includes('*')));
  check('an expired NCA card is flagged', seededWorkers.some((w) => w.ncaState === 'EXPIRED'));
  const one = seededWorkers.find((w) => w.name === 'Peter Onyango');
  check('the site supervisor opening a worker still sees the ID masked', (await siteUser.get(`/construction/workers/${one.id}`)).json.idNo.startsWith('****'));
  check('the accountant sees the full ID', /^\d{8}$/.test((await acc.get(`/construction/workers/${one.id}`)).json.idNo ?? ''));
  check('the QS cannot see the worker register', (await qs.get('/construction/workers')).status === 403);
  check('site staff cannot add a worker to a project they are not on', (await siteUser.post('/construction/workers', { name: 'Off project', trade: 'Mason', dailyRate: 1000, projectId: pid })).status === 403);
  const newW = await siteUser.post('/construction/workers', { name: `New Mason ${tag}`, trade: 'Mason', dailyRate: 1500, projectId: sid, idNo: `3${String(Date.now()).slice(-7)}`, phone: '0711222333' });
  check('the site supervisor adds a worker to their project', newW.status === 201 && newW.json.idNo.startsWith('****'), newW.json);
  check('the same ID number cannot be registered twice', (await siteUser.post('/construction/workers', { name: 'Dup', trade: 'Mason', dailyRate: 1, projectId: sid, idNo: (await acc.get(`/construction/workers/${newW.json.id}`)).json.idNo })).status === 409);
  check('a supervisor without a card is refused', (await siteUser.post('/construction/workers', { name: 'Foreman two', trade: 'Foreman', dailyRate: 1800, projectId: sid, isSupervisor: true })).status === 400);
  check('a supervisor with an expired card is refused', (await siteUser.post('/construction/workers', { name: 'Foreman two', trade: 'Foreman', dailyRate: 1800, projectId: sid, isSupervisor: true, ncaCardNo: 'X1', ncaExpiresAt: '2026-01-01' })).status === 400);
  check('a bad ID number is refused', (await siteUser.post('/construction/workers', { name: 'Bad id', trade: 'Mason', dailyRate: 1, projectId: sid, idNo: 'abc' })).status === 400);
  check('plan usage counts active workers', (await dir.get('/construction/plan')).json.usage.workers >= 16);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_MJENGO' WHERE "organizationId" = $1`, [orgId]);
  const overWorkers = await siteUser.post('/construction/workers', { name: 'One too many', trade: 'Helper', dailyRate: 800, projectId: sid });
  check('on Mjengo (10 workers) another worker asks to upgrade', overWorkers.status === 402 && /10 workers/.test(overWorkers.json.message), overWorkers.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);

  const today = nairobi();
  const sheet = (await siteUser.get(`/construction/projects/${sid}/muster?date=${today}`)).json;
  check("today's muster lists the project's workers", sheet.rows.length >= 16 && sheet.date === today, sheet.rows?.length);
  const entries = sheet.rows.map((r, i) => ({ workerId: r.workerId, status: i === 0 ? 'ABSENT' : i === 1 ? 'HALF' : 'PRESENT', clientRef: `${r.workerId}:${tag}` }));
  const saved = await siteUser.post(`/construction/projects/${sid}/muster`, { date: today, entries });
  check('the supervisor saves the whole muster', saved.status === 200 && saved.json.saved === entries.length && saved.json.totals.absent === 1 && saved.json.totals.half === 1, saved.json);
  const again = await siteUser.post(`/construction/projects/${sid}/muster`, { date: today, entries });
  check('sending the same marks again (phone retry) changes nothing', again.json.totals.present === saved.json.totals.present && Number((await sql.query('SELECT count(*) FROM con_muster WHERE "projectId" = $1 AND date = $2::date', [sid, today])).rows[0].count) === entries.length);
  check('the muster cannot be marked for tomorrow', (await siteUser.post(`/construction/projects/${sid}/muster`, { date: nairobi(1), entries: entries.slice(0, 1) })).status === 400);
  check("a worker from another project is refused", (await siteUser.post(`/construction/projects/${sid}/muster`, { date: today, entries: [{ workerId: randomUUIDish(), status: 'PRESENT' }] })).status === 400);
  check('the QS cannot mark the muster', (await qs.post(`/construction/projects/${sid}/muster`, { date: today, entries: entries.slice(0, 1) })).status === 403);
  const summary = (await siteUser.get(`/construction/projects/${sid}/muster/summary?from=${nairobi(-6)}&to=${today}`)).json;
  check('the week summary counts days per worker (half days as half)', summary.length >= 15 && summary.every((s) => s.days <= 7) && summary.some((s) => s.half > 0), summary.slice(0, 2));

  const diaries = (await siteUser.get(`/construction/projects/${sid}/diaries`)).json;
  check('a week of diaries is seeded', diaries.length >= 7 && diaries.some((d) => d.status === 'APPROVED'));
  const approvedDay = diaries.find((d) => d.status === 'APPROVED').date;
  check('an approved diary is locked', (await siteUser.put(`/construction/projects/${sid}/diaries/${approvedDay}`, { worksDone: 'changed' })).status === 409);
  const todayDiary = (await siteUser.get(`/construction/projects/${sid}/diaries/${today}`)).json;
  check("today's diary shows labour from the muster", todayDiary.labourFromMuster === entries.length - 1, todayDiary);
  const savedDiary = await siteUser.put(`/construction/projects/${sid}/diaries/${today}`, { weather: 'Sunny', worksDone: 'Roof trusses lifted onto classroom 1.' });
  check('the supervisor writes today\'s diary', savedDiary.status === 200);
  check('a diary cannot be written for tomorrow', (await siteUser.put(`/construction/projects/${sid}/diaries/${nairobi(1)}`, { worksDone: 'x' })).status === 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const photo = await call('POST', `/construction/projects/${sid}/photos?lat=-0.9467&lng=34.4719&caption=Trusses`, { token: siteUser._token, raw: png, headers: { 'Content-Type': 'image/png' } });
  check('a geo-tagged photo uploads from the phone', photo.status === 201 && photo.json.lat === -0.9467 && photo.json.date === today, photo.json);
  check('it shows on today\'s diary', (await siteUser.get(`/construction/projects/${sid}/diaries/${today}`)).json.photos.some((p) => p.id === photo.json.id));
  check('the photo comes back through the API', (await call('GET', `/construction/projects/${sid}/photos/${photo.json.id}/file`, { token: siteUser._token })).buf.equals(png));
  check('a non-image is refused', (await call('POST', `/construction/projects/${sid}/photos`, { token: siteUser._token, raw: Buffer.from('x'), headers: { 'Content-Type': 'text/plain' } })).status === 400);
  check('only the PM approves the diary', (await siteUser.post(`/construction/projects/${sid}/diaries/${today}/approve`, {})).status === 403);
  check('the supervisor submits it', (await siteUser.post(`/construction/projects/${sid}/diaries/${today}/submit`, {})).json.status === 'SUBMITTED');
  const pm = as(await login('pm@uriri.demo'));
  check('the PM approves it', (await pm.post(`/construction/projects/${sid}/diaries/${today}/approve`, {})).json.status === 'APPROVED');
  check('no photos can be added to an approved day', (await call('POST', `/construction/projects/${sid}/photos`, { token: siteUser._token, raw: png, headers: { 'Content-Type': 'image/png' } })).status === 409);

  const instr = await pm.post(`/construction/projects/${sid}/instructions`, { issuedByName: 'Arch. P. Ochieng', date: today, description: 'Change roof pitch to 25 degrees on classroom 3.' });
  check('the PM records a site instruction, numbered', instr.status === 201 && /^SI-\d{3}$/.test(instr.json.number), instr.json);
  check('it can be marked actioned', (await pm.patch(`/construction/projects/${sid}/instructions/${instr.json.id}`, { status: 'ACTIONED' })).json.status === 'ACTIONED');
  check('an instruction needs who issued it', (await pm.post(`/construction/projects/${sid}/instructions`, { date: today, description: 'No issuer here' })).status === 400);

  const safetyReg = (await siteUser.get(`/construction/projects/${sid}/safety`)).json;
  check('safety registers are seeded: talks, PPE, a permit, incidents', safetyReg.talks.length >= 2 && safetyReg.ppe.length >= 20 && safetyReg.permits.length >= 1 && safetyReg.incidents.length >= 2);
  const lost = safetyReg.incidents.find((i) => i.severity === 'LOST_TIME');
  check('the lost-time incident must be reported to DOSHS, with a due date', lost?.mustReport && !lost.reportedToDoshs && !!lost.reportDueAt, lost);
  const talk = await siteUser.post(`/construction/projects/${sid}/toolbox-talks`, { date: today, topic: 'Lifting trusses safely', attendeeIds: entries.slice(0, 5).map((e) => e.workerId) });
  check('a toolbox talk with attendees is recorded', talk.status === 201);
  check('PPE is issued to a worker', (await siteUser.post(`/construction/projects/${sid}/ppe`, { workerId: entries[2].workerId, item: 'Harness', issuedAt: today })).status === 201);
  const ptw = await siteUser.post(`/construction/projects/${sid}/work-permits`, { type: 'HOT_WORK', location: 'Steel gate', validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 8 * 3600000).toISOString() });
  check('a hot-works permit is issued and numbered', ptw.status === 201 && /^PTW-\d{3}$/.test(ptw.json.number), ptw.json);
  check('a permit longer than 7 days is refused', (await siteUser.post(`/construction/projects/${sid}/work-permits`, { type: 'HEIGHT', location: 'x1', validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 9 * 86400000).toISOString() })).status === 400);
  check('the permit is closed', (await siteUser.post(`/construction/projects/${sid}/work-permits/${ptw.json.id}/close`, {})).json.status === 'CLOSED');
  const fatal = await siteUser.post(`/construction/projects/${sid}/incidents`, { occurredAt: new Date(Date.now() - 30 * 3600000).toISOString(), severity: 'FATAL', description: 'Test fatal incident record', workerId: entries[3].workerId });
  check('a fatal incident is due to DOSHS within 24 hours', fatal.status === 201 && fatal.json.mustReport && Math.round((new Date(fatal.json.reportDueAt) - new Date(fatal.json.occurredAt)) / 3600000) === 24, fatal.json);
  await admin.post('/platform-admin/construction/alerts/run', {});
  const doshsAlerts = (await dir.get('/construction/alerts')).json.filter((a) => a.kind?.startsWith('DOSHS'));
  check('DOSHS alerts are raised: overdue for the fatal one, due for the lost-time one', doshsAlerts.some((a) => a.kind === 'DOSHS_OVERDUE') && doshsAlerts.some((a) => a.kind === 'DOSHS_DUE'), doshsAlerts.map((a) => a.title));
  check('the supervisor cannot record the DOSHS report', (await siteUser.post(`/construction/projects/${sid}/incidents/${fatal.json.id}/doshs`, { doshsRef: 'DOSHS/1' })).status === 403);
  check('the PM records it', (await pm.post(`/construction/projects/${sid}/incidents/${fatal.json.id}/doshs`, { doshsRef: `DOSHS/MGR/${tag}` })).json.reportedToDoshs === true);
  check('...once', (await pm.post(`/construction/projects/${sid}/incidents/${fatal.json.id}/doshs`, { doshsRef: 'again' })).status === 409);
  check('a QS cannot see the safety registers', (await qs.get(`/construction/projects/${sid}/safety`)).status === 403);
  check("another business cannot see Uriri's workers", (await fresh.get('/construction/workers')).json.length === 0);
  check("or its muster", (await fresh.get(`/construction/projects/${sid}/muster?date=${today}`)).json.rows?.length === 0);
  const c3audit = (await sql.query(`SELECT DISTINCT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'con_%'`, [orgId])).rows.map((r) => r.action);
  for (const a of ['con_worker.created', 'con_muster.saved', 'con_diary.saved', 'con_diary.approved', 'con_photo.uploaded', 'con_instruction.created', 'con_toolbox_talk.created', 'con_ppe.issued', 'con_work_permit.issued', 'con_incident.created', 'con_incident.reported_to_doshs']) {
    check(`audit: ${a}`, c3audit.includes(a));
  }
  const auditWorker = (await sql.query(`SELECT after FROM audit_log WHERE "organizationId" = $1 AND action = 'con_worker.created' ORDER BY "createdAt" DESC LIMIT 1`, [orgId])).rows[0];
  check('the audit log keeps the ID masked too', String(auditWorker.after.idNo).startsWith('****'));
  await sql.query('DELETE FROM con_incidents WHERE id = $1', [fatal.json.id]);
  await sql.query(`UPDATE con_site_diaries SET status = 'DRAFT', "approvedAt" = NULL WHERE "projectId" = $1 AND date = $2::date`, [sid, today]);
  await sql.query('DELETE FROM con_site_photos WHERE id = $1', [photo.json.id]);
  await sql.query('UPDATE con_workers SET "isActive" = false WHERE id = $1', [newW.json.id]);

  section('13d. Requisitions, LPOs, deliveries, site stock, reconciliation, plant (C4)');
  await sql.query(`UPDATE con_roles SET "approvalLimit" = 500000 WHERE "organizationId" = $1 AND code = 'CON_PROJECT_MGR'`, [orgId]);
  const proc = as(await login('procurement@uriri.demo'));
  const store = as(await login('store@uriri.demo'));
  const recon0 = (await pm.get(`/construction/projects/${sid}/reconciliation`)).json;
  const cement0 = recon0.find((r) => r.name.startsWith('Cement'));
  check('seeded reconciliation for cement: allowance, ordered, delivered, used, wasted, on site', cement0 && cement0.budget >= 1300 && cement0.ordered >= 400 && cement0.delivered >= 350 && cement0.wasted >= 6 && cement0.wastagePercent > 0, cement0);
  check('nothing is unaccounted for in the seed', recon0.every((r) => Math.abs(r.unaccounted) < 0.001), recon0.filter((r) => Math.abs(r.unaccounted) >= 0.001));
  const lpos0 = (await pm.get(`/construction/projects/${sid}/lpos`)).json;
  check('LPO-001 is part received and LPO-002 waits for approval', lpos0.some((l) => l.number === 'LPO-001' && l.status === 'PART_RECEIVED') && lpos0.some((l) => l.number === 'LPO-002' && l.status === 'AWAITING_APPROVAL'), lpos0.map((l) => [l.number, l.status]));
  const plantCost0 = (await pm.get(`/construction/projects/${sid}/plant-cost`)).json;
  const exc = plantCost0.rows?.find((r) => r.name.startsWith('Excavator'));
  check('hired excavator costs 3 days x 25,000 plus fuel', exc?.hireCost === 75000 && exc.fuelCost === 64800 && exc.total === 139800, exc);
  const stock0 = (await store.get(`/construction/projects/${sid}/stock`)).json;
  const cementVar = stock0.items.find((s) => s.name.startsWith('Cement'));
  const steelVar = stock0.items.find((s) => s.name.startsWith('Y12'));
  check('the site store holds the delivered less the issued', cementVar?.qty === cement0.onHand && stock0.value > 0, { stock: cementVar, recon: cement0.onHand });

  const myReq = await pm.post(`/construction/projects/${sid}/requisitions`, { lines: [{ variantId: cementVar.variantId, qty: 10 }] });
  check('the PM raises a requisition', myReq.status === 201 && /^REQ-\d{3}$/.test(myReq.json.number), myReq.json);
  check('...and cannot approve their own', (await pm.post(`/construction/projects/${sid}/requisitions/${myReq.json.id}/approve`, {})).status === 403);
  const req2 = await store.post(`/construction/projects/${sid}/requisitions`, { neededBy: nairobi(3), lines: [{ variantId: cementVar.variantId, qty: 100 }, { variantId: steelVar.variantId, qty: 20 }] });
  check('the storekeeper raises a requisition', req2.status === 201, req2.json);
  check('the storekeeper cannot approve requisitions', (await store.post(`/construction/projects/${sid}/requisitions/${req2.json.id}/approve`, {})).status === 403);
  check('the PM approves it', (await pm.post(`/construction/projects/${sid}/requisitions/${req2.json.id}/approve`, {})).json.status === 'APPROVED');
  check('a requisition item must be on this project\'s BQ', (await store.post(`/construction/projects/${sid}/requisitions`, { lines: [{ variantId: cementVar.variantId, qty: 1, bqItemId: randomUUIDish() }] })).status === 400);
  check('the PM rejects their own leftover requisition? no - someone else must', (await pm.post(`/construction/projects/${sid}/requisitions/${myReq.json.id}/reject`, { reason: 'Not needed now' })).status === 403);
  check('the director rejects it with a reason', (await dir.post(`/construction/projects/${sid}/requisitions/${myReq.json.id}/reject`, { reason: 'Not needed now' })).json.status === 'REJECTED');

  const supplierId = (await sql.query(`SELECT id FROM suppliers WHERE "organizationId" = $1 AND name LIKE 'Migori Hardware%'`, [orgId])).rows[0].id;
  check('only procurement raises LPOs', (await pm.post(`/construction/projects/${sid}/lpos`, { supplierId, lines: [{ variantId: cementVar.variantId, qty: 1, rate: 1 }] })).status === 403);
  check('a rejected requisition cannot be ordered', (await proc.post(`/construction/projects/${sid}/lpos`, { supplierId, requisitionId: myReq.json.id, lines: [{ variantId: cementVar.variantId, qty: 1, rate: 1 }] })).status === 409);
  const lpo = await proc.post(`/construction/projects/${sid}/lpos`, { supplierId, requisitionId: req2.json.id, deliverBy: nairobi(3), lines: [{ variantId: cementVar.variantId, qty: 100, rate: 780 }, { variantId: steelVar.variantId, qty: 20, rate: 1150 }] });
  check('procurement raises an LPO from the requisition: numbered, totalled, awaiting approval', lpo.status === 201 && /^LPO-\d{3}$/.test(lpo.json.number) && lpo.json.total === 101000 && lpo.json.status === 'AWAITING_APPROVAL', lpo.json);
  check('the requisition is now ordered', (await pm.get(`/construction/projects/${sid}/requisitions`)).json.find((r) => r.id === req2.json.id)?.status === 'ORDERED');
  const poStatus = async (lpoId) => (await sql.query('SELECT p.status FROM purchase_orders p JOIN con_lpos l ON l."purchaseOrderId" = p.id WHERE l.id = $1', [lpoId])).rows[0].status;
  check('behind it is a DRAFT purchase order to the project site', (await poStatus(lpo.json.id)) === 'DRAFT');
  check('an unapproved LPO cannot be received', (await store.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/receive`, { lines: [{ lineItemId: lpo.json.lines[0].lineItemId, quantity: 1 }] })).status === 409);
  check('procurement cannot approve', (await proc.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/approve`, {})).status === 403);
  const approvedLpo = await pm.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/approve`, {});
  check('the PM approves it within their limit; it is sent', approvedLpo.status === 200 && approvedLpo.json.status === 'SENT', approvedLpo.json);
  check('the purchase order is now ORDERED', (await poStatus(lpo.json.id)) === 'ORDERED');
  const printable = (await proc.get(`/construction/projects/${sid}/lpos/${lpo.json.id}`)).json;
  check('the LPO prints with the company, supplier, site and lines', printable.company?.name === 'Uriri Builders Ltd' && printable.supplier?.name?.startsWith('Migori') && printable.project?.code === 'PRJ-001' && printable.lines.length === 2, printable);

  const bigLpo = await proc.post(`/construction/projects/${sid}/lpos`, { supplierId, lines: [{ variantId: steelVar.variantId, qty: 600, rate: 1150 }] });
  const overLimit = await pm.post(`/construction/projects/${sid}/lpos/${bigLpo.json.id}/approve`, {});
  check('a 690,000 LPO is above the PM limit (500,000)', overLimit.status === 403 && /approval limit of KES 500,000/.test(overLimit.json.message), overLimit.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_FUNDI' WHERE "organizationId" = $1`, [orgId]);
  const onFundi = await pm.post(`/construction/projects/${sid}/lpos/${bigLpo.json.id}/approve`, {});
  check('on Fundi (no approval limits) the PM may approve it', onFundi.status === 200 && onFundi.json.status === 'SENT', onFundi.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);
  check('it can be cancelled before anything arrives', (await proc.post(`/construction/projects/${sid}/lpos/${bigLpo.json.id}/cancel`, {})).json.status === 'CANCELLED');
  const dirLpo = await dir.post(`/construction/projects/${sid}/lpos`, { supplierId, lines: [{ variantId: cementVar.variantId, qty: 1, rate: 780 }] });
  check('even the Director cannot approve an LPO they raised', (await dir.post(`/construction/projects/${sid}/lpos/${dirLpo.json.id}/approve`, {})).status === 403);
  await proc.post(`/construction/projects/${sid}/lpos/${dirLpo.json.id}/cancel`, {});

  const cementLine = approvedLpo.json.lines.find((l) => l.name.startsWith('Cement'));
  const steelLine = approvedLpo.json.lines.find((l) => l.name.startsWith('Y12'));
  const grn1 = await store.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/receive`, { deliveryNote: `DN-${tag}`, lines: [{ lineItemId: cementLine.lineItemId, quantity: 60, damaged: 2 }] });
  check('the storekeeper receives a part delivery with a GRN number', grn1.status === 200 && /^GRN-\d{4}-\d{4}$/.test(grn1.json.receiptNumber) && grn1.json.lpo.status === 'PART_RECEIVED', grn1.json);
  check('more than is outstanding is refused', (await store.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/receive`, { lines: [{ lineItemId: cementLine.lineItemId, quantity: 50 }] })).status === 400);
  check('the PM cannot record deliveries', (await pm.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/receive`, { lines: [{ lineItemId: steelLine.lineItemId, quantity: 1 }] })).status === 403);
  const grn2 = await store.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/receive`, { lines: [{ lineItemId: cementLine.lineItemId, quantity: 40 }, { lineItemId: steelLine.lineItemId, quantity: 20 }] });
  check('the rest arrives: received in full', grn2.json.lpo?.status === 'RECEIVED', grn2.json);
  check('a received LPO cannot be cancelled', (await proc.post(`/construction/projects/${sid}/lpos/${lpo.json.id}/cancel`, {})).status === 409);
  const stock1 = (await store.get(`/construction/projects/${sid}/stock`)).json;
  check('site stock went up by what was accepted (100 bags; the 2 damaged stay owed and came later)', stock1.items.find((s) => s.variantId === cementVar.variantId).qty === cementVar.qty + 100);
  const txns = Number((await sql.query(`SELECT count(*) FROM inventory_transactions t JOIN con_projects p ON p."branchId" = t."branchId" WHERE p.id = $1 AND t.type = 'RECEIPT'`, [sid])).rows[0].count);
  check('deliveries are in the normal stock ledger of the site branch', txns >= 6, txns);

  const concreteItem = seededBq.sections.flatMap((s) => s.items).find((i) => i.description.startsWith('Concrete class 25'));
  const iss = await store.post(`/construction/projects/${sid}/issues`, { variantId: cementVar.variantId, qty: 40, kind: 'USED', bqItemId: concreteItem.id, issuedTo: 'Foreman' });
  check('the storekeeper issues cement to a BQ item', iss.status === 201, iss.json);
  check('wastage is recorded', (await store.post(`/construction/projects/${sid}/issues`, { variantId: cementVar.variantId, qty: 2, kind: 'WASTED', note: 'Hardened' })).status === 201);
  check('more than is on site cannot be issued', (await store.post(`/construction/projects/${sid}/issues`, { variantId: cementVar.variantId, qty: 100000 })).status === 400);
  check('whole bags only (count material)', (await store.post(`/construction/projects/${sid}/issues`, { variantId: cementVar.variantId, qty: 1.5 })).status === 400);
  check('a QS cannot issue material', (await qs.post(`/construction/projects/${sid}/issues`, { variantId: cementVar.variantId, qty: 1 })).status === 403);
  const recon1 = (await qs.get(`/construction/projects/${sid}/reconciliation`)).json.find((r) => r.variantId === cementVar.variantId);
  check('reconciliation moves: +100 ordered, +100 delivered, +40 used, +2 wasted', recon1.ordered === cement0.ordered + 100 && recon1.delivered === cement0.delivered + 100 && recon1.used === cement0.used + 40 && recon1.wasted === cement0.wasted + 2 && Math.abs(recon1.unaccounted) < 0.001, { recon1, cement0 });
  check('the QS sets a BQ allowance', (await qs.put(`/construction/projects/${sid}/material-budgets`, { variantId: cementVar.variantId, qty: 1350 })).status === 200 && (await qs.get(`/construction/projects/${sid}/reconciliation`)).json.find((r) => r.variantId === cementVar.variantId).budget === 1350);
  check('the storekeeper cannot change allowances', (await store.put(`/construction/projects/${sid}/material-budgets`, { variantId: cementVar.variantId, qty: 1 })).status === 403);

  const hired = await proc.post('/construction/plant', { name: `Roller ${tag}`, ownership: 'HIRED', hireRate: 3500, rateUnit: 'HOUR', projectId: sid });
  check('procurement registers hired plant', hired.status === 201, hired.json);
  check('hired plant needs a rate', (await proc.post('/construction/plant', { name: 'No rate', ownership: 'HIRED' })).status === 400);
  const pl = await siteUser.post(`/construction/projects/${sid}/plant-logs`, { plantId: hired.json.id, date: nairobi(), hours: 6, fuelLitres: 30, fuelCost: 5400, operator: 'Op' });
  check('the site supervisor logs a day of plant use', pl.status === 201, pl.json);
  await siteUser.post(`/construction/projects/${sid}/plant-logs`, { plantId: hired.json.id, date: nairobi(), hours: 7, fuelLitres: 30, fuelCost: 5400 });
  const roller = (await pm.get(`/construction/projects/${sid}/plant-cost`)).json.rows.find((r) => r.plantId === hired.json.id);
  check('logging the same day again corrects it; hourly hire is 7 h x 3,500 + fuel', roller?.hours === 7 && roller.hireCost === 24500 && roller.total === 29900, roller);
  check('plant cannot be logged for tomorrow', (await siteUser.post(`/construction/projects/${sid}/plant-logs`, { plantId: hired.json.id, date: nairobi(1), hours: 1 })).status === 400);
  check('the site supervisor cannot add plant to the register', (await siteUser.post('/construction/plant', { name: 'x2', ownership: 'OWNED' })).status === 403);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_FUNDI' WHERE "organizationId" = $1`, [orgId]);
  const fundiPlant = await pm.get('/construction/plant');
  check('Fundi has no plant management (upgrade prompt)', fundiPlant.status === 402 && fundiPlant.json.feature === 'plant', fundiPlant.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);

  check("another business cannot see Uriri's LPOs or stock", (await fresh.get(`/construction/projects/${sid}/lpos`)).json.length === 0 && (await fresh.get(`/construction/projects/${sid}/stock`)).status === 404);
  const c4audit = (await sql.query(`SELECT DISTINCT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'con_%'`, [orgId])).rows.map((r) => r.action);
  for (const a of ['con_requisition.created', 'con_requisition.approved', 'con_requisition.rejected', 'con_lpo.created', 'con_lpo.approved', 'con_lpo.cancelled', 'con_lpo.received', 'con_material.issued', 'con_material.wasted', 'con_material_budget.set', 'con_plant.created', 'con_plant_log.created', 'con_plant_log.corrected']) {
    check(`audit: ${a}`, c4audit.includes(a));
  }
  await sql.query('UPDATE con_plant SET "isActive" = false WHERE id = $1', [hired.json.id]);

  section('13e. Variations, valuations/IPCs, retention, eTIMS invoices, receipts, subcontracts (C5)');
  const resetC5 = async () => {
    await sql.query(`UPDATE con_valuations SET "reversesId" = NULL WHERE "projectId" = $1 AND number > 2`, [sid]);
    await sql.query(`DELETE FROM con_retention_ledger WHERE "projectId" = $1 AND ("valuationId" IS NULL OR "valuationId" IN (SELECT id FROM con_valuations WHERE "projectId" = $1 AND number > 2))`, [sid]);
    await sql.query(`DELETE FROM con_valuations WHERE "projectId" = $1 AND number > 2`, [sid]);
    await sql.query(`DELETE FROM con_valuation_receipts WHERE "valuationId" IN (SELECT id FROM con_valuations WHERE "projectId" = $1 AND number = 2)`, [sid]);
    await sql.query(`UPDATE con_valuations SET status = 'CERTIFIED', reversed = false, "saleId" = NULL, "invoicedAt" = NULL, "vatRate" = NULL, "vatAmount" = NULL, "invoiceTotal" = NULL, "paidAt" = NULL WHERE "projectId" = $1 AND number = 2`, [sid]);
    await sql.query(`UPDATE con_site_instructions SET "variationId" = NULL WHERE "variationId" IN (SELECT id FROM con_variations WHERE "projectId" = $1 AND ref <> 'VO-001')`, [sid]);
    await sql.query(`DELETE FROM con_variations WHERE "projectId" = $1 AND ref <> 'VO-001'`, [sid]);
    await sql.query(`UPDATE con_projects SET "revisedSum" = "contractSum" + 85000, status = 'ACTIVE' WHERE id = $1`, [sid]);
    await sql.query(`DELETE FROM con_subcontracts WHERE "projectId" = $1`, [sid]);
  };
  await resetC5();
  const V = `/construction/projects/${sid}`;
  const near = (a, b) => Math.abs(a - b) < 0.011;
  const r2 = (x) => Math.round(x * 100) / 100;
  const revised = async () => Number((await sql.query('SELECT "revisedSum" FROM con_projects WHERE id = $1', [sid])).rows[0].revisedSum);
  const contractSum = Number((await sql.query('SELECT "contractSum" FROM con_projects WHERE id = $1', [sid])).rows[0].contractSum);
  const cap = r2(contractSum * 0.05);

  const vals0 = (await qs.get(`${V}/valuations`)).json;
  const ipc1 = vals0.find((v) => v.number === 1);
  const ipc2 = vals0.find((v) => v.number === 2);
  check('seeded IPC 1 is paid and IPC 2 is certified, not invoiced', ipc1?.status === 'PAID' && ipc1.invoiced && ipc2?.status === 'CERTIFIED' && !ipc2.invoiced, vals0);
  const ipc1View = (await acc.get(`${V}/valuations/${ipc1.id}`)).json;
  check('IPC 1 reconciles: payment + WHT + WHT-VAT certificates cover the invoice', ipc1View.balance?.settled === true && ipc1View.receipts.length === 3 && near(ipc1View.invoiceTotal, r2(ipc1View.netDue * 1.16)), ipc1View.balance);
  check('the IPC prints with the company, project, client and valuation lines', ipc1View.company?.name === 'Uriri Builders Ltd' && ipc1View.project?.code === 'PRJ-001' && ipc1View.lines.length > 5);
  const ret0 = (await qs.get(`${V}/retention`)).json;
  check('retention ledger holds what IPC 2 deducted, cap is 5% of the contract sum', near(ret0.held, 506324) && near(ret0.cap, cap) && ret0.entries.length === 2, ret0);
  check('the site supervisor cannot see the money side (403)', (await siteUser.get(`${V}/valuations`)).status === 403);

  const vo0 = (await pm.get(`${V}/variations`)).json;
  check('VO-001 is approved and linked to site instruction SI-001', vo0.some((v) => v.ref === 'VO-001' && v.status === 'APPROVED' && v.instruction?.number === 'SI-001'), vo0);
  check('a site instruction can carry only one variation', (await qs.post(`${V}/variations`, { description: 'Dup', amount: 1, instructionId: vo0.find((v) => v.ref === 'VO-001').instruction.id })).status === 409);
  const voA = await pm.post(`${V}/variations`, { description: `Extra drainage ${tag}`, amount: 0 });
  check('the PM raises an unpriced variation (PROPOSED)', voA.status === 201 && /^VO-\d{3}$/.test(voA.json.ref) && voA.json.status === 'PROPOSED', voA.json);
  check('an unpriced variation cannot be decided', (await dir.post(`${V}/variations/${voA.json.id}/decision`, { decision: 'APPROVE' })).status === 409);
  check('pricing it makes it PRICED', (await pm.put(`${V}/variations/${voA.json.id}`, { description: `Extra drainage ${tag}`, amount: 120000 })).json.status === 'PRICED');
  check('the PM cannot decide variations', (await pm.post(`${V}/variations/${voA.json.id}/decision`, { decision: 'APPROVE' })).status === 403);
  const sumBefore = await revised();
  const appr = await dir.post(`${V}/variations/${voA.json.id}/decision`, { decision: 'APPROVE', approvedByName: 'Arch. P. Ochieng' });
  check('the Director approves it', appr.status === 200 && appr.json.status === 'APPROVED', appr.json);
  check('approval raises the revised contract sum by 120,000', near(await revised(), sumBefore + 120000) && near(sumBefore, contractSum + 85000));
  check('an approved variation is locked', (await pm.put(`${V}/variations/${voA.json.id}`, { description: 'Changed after approval', amount: 1 })).status === 409);
  const voB = await pm.post(`${V}/variations`, { description: `Gate canopy ${tag}`, amount: 50000 });
  const rej = await dir.post(`${V}/variations/${voB.json.id}/decision`, { decision: 'REJECT', reason: 'Not instructed' });
  check('a rejected variation leaves the revised sum alone', rej.json.status === 'REJECTED' && near(await revised(), sumBefore + 120000), rej.json);
  const voC = await dir.post(`${V}/variations`, { description: `Director VO ${tag}`, amount: 10000 });
  check('whoever raised a variation cannot decide it', (await dir.post(`${V}/variations/${voC.json.id}/decision`, { decision: 'APPROVE' })).status === 403);

  check('the PM cannot invoice an IPC', (await pm.post(`${V}/valuations/${ipc2.id}/invoice`, {})).status === 403);
  const inv2 = await acc.post(`${V}/valuations/${ipc2.id}/invoice`, {});
  check('accounts invoices certified IPC 2 with 16% VAT from tax settings', inv2.status === 200 && inv2.json.vatRate === 16 && near(inv2.json.vatAmount, r2(ipc2.netDue * 0.16)) && near(inv2.json.invoiceTotal, r2(ipc2.netDue * 1.16)), inv2.json);
  const sale2 = (await sql.query(`SELECT s.id, s."clientId" FROM sales s JOIN con_valuations v ON v."saleId" = s.id WHERE v.id = $1`, [ipc2.id])).rows[0];
  check('...as a normal sale on account, so it reaches eTIMS like any other sale', sale2?.clientId === `con-ipc-${ipc2.id}`, sale2);
  check('an IPC is invoiced once', (await acc.post(`${V}/valuations/${ipc2.id}/invoice`, {})).status === 409);
  check('the QS cannot record money received', (await qs.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'PAYMENT', amount: 1, method: 'BANK', receivedAt: nairobi() })).status === 403);
  check('a withholding certificate needs its number', (await acc.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'WHT', amount: 1, receivedAt: nairobi() })).status === 400);
  const ew = inv2.json.expectedWithholding;
  check('expected withholding is 3% WHT and 2% WHT-VAT of the net', near(ew.wht, r2(ipc2.netDue * 0.03)) && near(ew.whtVat, r2(ipc2.netDue * 0.02)), ew);
  await acc.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'WHT', amount: ew.wht, certificateNo: `WHT-${tag}`, receivedAt: nairobi() });
  const afterWht = await acc.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'WHT_VAT', amount: ew.whtVat, certificateNo: `WHV-${tag}`, receivedAt: nairobi() });
  const owed = afterWht.json.balance.outstanding;
  check('certificates reduce what is still owed', near(owed, r2(inv2.json.invoiceTotal - ew.wht - ew.whtVat)), afterWht.json.balance);
  check('more than is owed is refused', (await acc.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'PAYMENT', amount: owed + 100, method: 'BANK', receivedAt: nairobi() })).status === 400);
  const paid2 = await acc.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'PAYMENT', amount: owed, method: 'MPESA', reference: `QK${tag}`.toUpperCase(), receivedAt: nairobi() });
  check('the payment settles it: IPC 2 is PAID', paid2.json.status === 'PAID' && paid2.json.balance.settled, paid2.json.balance);
  check('nothing more can be recorded on a paid IPC', (await acc.post(`${V}/valuations/${ipc2.id}/receipts`, { kind: 'PAYMENT', amount: 1, method: 'BANK', receivedAt: nairobi() })).status === 409);

  check('only the QS or Contracts Manager starts valuations (PM 403)', (await pm.get(`${V}/valuations/template`)).status === 403);
  const tpl = (await qs.get(`${V}/valuations/template`)).json;
  check('the template starts from IPC 2 and lists both approved variations', tpl.last?.number === 2 && tpl.variations.length === 2 && tpl.sections.some((s) => s.items.some((i) => i.lastQtyToDate > 0)), { last: tpl.last, vos: tpl.variations.length });
  const items = tpl.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.name })));
  const qtyFor = (i) => (i.section === 'SUPERSTRUCTURE' ? Math.round(i.qty * 0.9 * 1000) / 1000 : i.section === 'PRELIMINARIES' || i.section === 'SUBSTRUCTURE' ? i.qty : i.lastQtyToDate);
  const body3 = (mos, over) => ({
    periodEnd: nairobi(), materialsOnSite: mos, advanceRecovery: 0,
    lines: [...items.filter((i) => qtyFor(i) > 0).map((i, k) => ({ bqItemId: i.bqItemId, qtyToDate: over && k === 0 ? i.qty * 2 : qtyFor(i) })), ...tpl.variations.map((x) => ({ variationId: x.variationId, amountToDate: x.amount }))],
  });
  const work3 = r2(items.filter((i) => qtyFor(i) > 0).reduce((a, i) => a + r2(qtyFor(i) * i.rate), 0));
  const prevNet = r2(ipc1.netDue + ipc2.netDue);
  check('accounts cannot prepare valuations', (await acc.post(`${V}/valuations`, body3(0))).status === 403);
  check('a valuation cannot be dated in the future', (await qs.post(`${V}/valuations`, { ...body3(0), periodEnd: nairobi(2) })).status === 400);
  check('a rejected variation cannot be valued', (await qs.post(`${V}/valuations`, { ...body3(0), lines: [...body3(0).lines, { variationId: voB.json.id, amountToDate: 1 }] })).status === 400);
  check('a BQ item from elsewhere is refused', (await qs.post(`${V}/valuations`, { ...body3(0), lines: [{ bqItemId: randomUUIDish(), qtyToDate: 1 }] })).status === 400);
  const v3 = await qs.post(`${V}/valuations`, body3(100000));
  const gross3 = r2(work3 + 205000 + 100000);
  const ret3 = Math.min(r2(gross3 * 0.1), cap);
  check('the QS saves valuation 3 as a DRAFT', v3.status === 201 && v3.json.number === 3 && v3.json.status === 'DRAFT', v3.json);
  check('work, variations (85,000 + 120,000) and materials add to the gross', near(v3.json.workToDate, work3) && near(v3.json.variationsToDate, 205000) && near(v3.json.grossToDate, gross3), { got: v3.json.grossToDate, want: gross3 });
  check('retention is 10% but stops at the 5% cap', near(v3.json.retentionDeducted, ret3) && ret3 === cap, { got: v3.json.retentionDeducted, cap });
  check('net due = gross - retention - certified before', near(v3.json.previousCertified, prevNet) && near(v3.json.netDue, r2(gross3 - ret3 - prevNet)), { net: v3.json.netDue });
  check('one valuation is worked on at a time', (await qs.post(`${V}/valuations`, body3(0))).status === 409);
  const overQty = await qs.put(`${V}/valuations/${v3.json.id}`, body3(100000, true));
  check('more than the BQ quantity is allowed with a warning', overQty.status === 200 && overQty.json.warnings.length > 0, overQty.json.warnings);
  const fixed = await qs.put(`${V}/valuations/${v3.json.id}`, body3(80000));
  check('the QS corrects the draft (materials 80,000)', near(fixed.json.materialsOnSite, 80000) && near(fixed.json.netDue, r2(gross3 - 20000 - ret3 - prevNet)), fixed.json.netDue);
  check('the QS cannot approve and send it', (await qs.post(`${V}/valuations/${v3.json.id}/submit`, {})).status === 403);
  check('it cannot be certified before it is sent', (await qs.post(`${V}/valuations/${v3.json.id}/certify`, { certifiedByName: 'QS M. Akinyi', certifiedAt: nairobi() })).status === 409);
  check('the Director approves and sends it to the client\'s QS', (await dir.post(`${V}/valuations/${v3.json.id}/submit`, {})).json.status === 'SUBMITTED');
  check('once sent it cannot be edited', (await qs.put(`${V}/valuations/${v3.json.id}`, body3(0))).status === 409);
  check('a certificate cannot be dated in the future', (await qs.post(`${V}/valuations/${v3.json.id}/certify`, { certifiedByName: 'QS M. Akinyi', certifiedAt: nairobi(3) })).status === 400);
  const c3 = await qs.post(`${V}/valuations/${v3.json.id}/certify`, { certifiedByName: 'QS M. Akinyi', certifiedRef: `LQS/${tag}/3`, certifiedAt: nairobi() });
  check('the QS records the client\'s certificate: IPC 3 CERTIFIED', c3.status === 200 && c3.json.status === 'CERTIFIED' && c3.json.certifiedRef === `LQS/${tag}/3`, c3.json);
  check('a certified IPC cannot be edited or certified again', (await qs.put(`${V}/valuations/${v3.json.id}`, body3(0))).status === 409 && (await qs.post(`${V}/valuations/${v3.json.id}/certify`, { certifiedByName: 'x y', certifiedAt: nairobi() })).status === 409);
  const ret1 = (await qs.get(`${V}/retention`)).json;
  check('the ledger takes only the extra retention: now held = the cap', near(ret1.held, cap) && near(ret1.entries[ret1.entries.length - 1].amount, r2(cap - 506324)), ret1.held);

  check('an earlier IPC cannot be reversed while a later one stands', (await qs.post(`${V}/valuations/${ipc2.id}/reverse`, {})).status === 409);
  const inv3 = await acc.post(`${V}/valuations/${v3.json.id}/invoice`, {});
  check('IPC 3 is invoiced', inv3.status === 200 && inv3.json.invoiced, inv3.json);
  check('accounts cannot reverse a certificate', (await acc.post(`${V}/valuations/${v3.json.id}/reverse`, {})).status === 403);
  const rev = await qs.post(`${V}/valuations/${v3.json.id}/reverse`, {});
  check('the QS raises a reversing certificate (IPC 4) for minus the net', rev.status === 200 && rev.json.kind === 'REVERSAL' && rev.json.number === 4 && rev.json.reverses === 3 && rev.json.status === 'SUBMITTED' && near(rev.json.netDue, -fixed.json.netDue), rev.json);
  check('it carries back IPC 2\'s figures to date', near(rev.json.grossToDate, (await qs.get(`${V}/valuations/${ipc2.id}`)).json.grossToDate));
  check('IPC 3 cannot be reversed twice', (await qs.post(`${V}/valuations/${v3.json.id}/reverse`, {})).status === 409);
  const crev = await qs.post(`${V}/valuations/${rev.json.id}/certify`, { certifiedByName: 'QS M. Akinyi', certifiedAt: nairobi() });
  check('the reversal is certified', crev.json.status === 'CERTIFIED', crev.json);
  const credit = (await sql.query(`SELECT amount, "saleId" FROM refunds WHERE "clientId" = $1`, [`con-ipc-credit-${rev.json.id}`])).rows[0];
  check('...and IPC 3\'s invoice is credited (credit note via eTIMS)', credit && near(Number(credit.amount), inv3.json.invoiceTotal), credit);
  check('a reversed IPC cannot be invoiced', (await acc.post(`${V}/valuations/${rev.json.id}/invoice`, {})).status === 409);
  const ret2 = (await qs.get(`${V}/retention`)).json;
  check('retention goes back to what IPC 2 held', near(ret2.held, 506324), ret2.held);
  const v5 = await qs.post(`${V}/valuations`, body3(80000));
  check('the corrected valuation (IPC 5) sees the same certified-before as IPC 3 did', v5.json.number === 5 && near(v5.json.previousCertified, prevNet) && near(v5.json.netDue, fixed.json.netDue), { n: v5.json.number, prev: v5.json.previousCertified });

  check('retention is not released before practical completion', (await qs.post(`${V}/retention/release`, { percent: 50, stage: 'PRACTICAL_COMPLETION' })).status === 409);
  await sql.query(`UPDATE con_projects SET status = 'PRACTICAL_COMPLETION' WHERE id = $1`, [sid]);
  check('the PM cannot release retention', (await pm.post(`${V}/retention/release`, { percent: 50, stage: 'PRACTICAL_COMPLETION' })).status === 403);
  const rel1 = await qs.post(`${V}/retention/release`, { percent: 50, stage: 'PRACTICAL_COMPLETION' });
  check('half is released at practical completion', near(rel1.json.released, 253162) && near(rel1.json.held, 253162), rel1.json);
  check('the rest waits for the end of the defects period', (await qs.post(`${V}/retention/release`, { percent: 100, stage: 'END_OF_DLP' })).status === 409);
  await sql.query(`UPDATE con_projects SET status = 'DLP' WHERE id = $1`, [sid]);
  const rel2 = await dir.post(`${V}/retention/release`, { percent: 100, stage: 'END_OF_DLP' });
  check('the balance is released at the end of the defects period', near(rel2.json.released, 253162) && near(rel2.json.held, 0), rel2.json);
  check('nothing left to release', (await qs.post(`${V}/retention/release`, { percent: 100, stage: 'END_OF_DLP' })).status === 409);
  await sql.query(`UPDATE con_projects SET status = 'ACTIVE' WHERE id = $1`, [sid]);
  await sql.query(`DELETE FROM con_retention_ledger WHERE "projectId" = $1 AND type = 'RELEASE'`, [sid]);

  const subs402 = await qs.get(`${V}/subcontracts`);
  check('subcontract accounts are a Pro feature (upgrade prompt on Contractor)', subs402.status === 402 && subs402.json.feature === 'subcontracts', subs402.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_PRO' WHERE "organizationId" = $1`, [orgId]);
  const subParty = await dir.post('/construction/parties', { kind: 'SUBCONTRACTOR', name: `Okoth Plumbing ${tag}` });
  const clientParty = (await dir.get('/construction/parties')).json.find((p) => p.kind === 'CLIENT');
  check('only a subcontractor can hold a subcontract', (await qs.post(`${V}/subcontracts`, { partyId: clientParty.id, scope: 'x', sum: 1000 })).status === 400);
  const sc = await qs.post(`${V}/subcontracts`, { partyId: subParty.json.id, scope: 'Plumbing and drainage', sum: 1000000 });
  check('the QS lets a subcontract (SC-001, 10% retention, 5% cap)', sc.status === 201 && sc.json.ref === 'SC-001' && Number(sc.json.retentionRate) === 10, sc.json);
  const sv1 = await qs.post(`${V}/subcontracts/${sc.json.id}/valuations`, { grossToDate: 300000 });
  check('subcontract valuation 1: 300,000 less 10% retention = 270,000', near(Number(sv1.json.retention), 30000) && near(Number(sv1.json.netDue), 270000), sv1.json);
  check('one draft at a time', (await qs.post(`${V}/subcontracts/${sc.json.id}/valuations`, { grossToDate: 1 })).status === 409);
  check('the QS cannot approve it', (await qs.post(`${V}/subcontracts/${sc.json.id}/valuations/${sv1.json.id}/approve`, {})).status === 403);
  check('it cannot be paid before approval', (await acc.post(`${V}/subcontracts/${sc.json.id}/valuations/${sv1.json.id}/paid`, { paymentRef: 'X1' })).status === 409);
  check('the Director approves it', (await dir.post(`${V}/subcontracts/${sc.json.id}/valuations/${sv1.json.id}/approve`, {})).json.status === 'APPROVED');
  check('accounts marks it paid', (await acc.post(`${V}/subcontracts/${sc.json.id}/valuations/${sv1.json.id}/paid`, { paymentRef: `EFT-${tag}` })).json.status === 'PAID');
  const sv2 = await qs.post(`${V}/subcontracts/${sc.json.id}/valuations`, { grossToDate: 800000 });
  check('valuation 2: retention capped at 50,000, less 270,000 paid = 480,000', near(Number(sv2.json.retention), 50000) && near(Number(sv2.json.previousPaid), 270000) && near(Number(sv2.json.netDue), 480000), sv2.json);
  check('a draft can be removed', (await qs.del(`${V}/subcontracts/${sc.json.id}/valuations/${sv2.json.id}`)).status === 200);
  const scList = (await pm.get(`${V}/subcontracts`)).json.find((s) => s.id === sc.json.id);
  check('the subcontract account shows 270,000 paid and 30,000 retention held', scList?.paid === 270000 && scList.retentionHeld === 30000, scList);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);

  const foreign = await fresh.get(`${V}/valuations`);
  check("another business cannot see or certify Uriri's IPCs", (foreign.status === 404 || (Array.isArray(foreign.json) && foreign.json.length === 0)) && (await fresh.post(`${V}/valuations/${v5.json.id}/submit`, {})).status >= 403);
  const c5audit = (await sql.query(`SELECT DISTINCT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'con_%'`, [orgId])).rows.map((r) => r.action);
  for (const a of ['con_variation.created', 'con_variation.updated', 'con_variation.approved', 'con_variation.rejected', 'con_project.revised_sum_changed', 'con_valuation.created', 'con_valuation.updated', 'con_valuation.submitted', 'con_valuation.certified', 'con_valuation.reversal_raised', 'con_valuation.invoiced', 'con_valuation.receipt_recorded', 'con_retention.released', 'con_subcontract.created', 'con_sub_valuation.approved', 'con_sub_valuation.paid', 'con_sub_valuation.deleted']) {
    check(`audit: ${a}`, c5audit.includes(a));
  }

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
