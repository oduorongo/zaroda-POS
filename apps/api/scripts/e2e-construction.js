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
  check('roles, caps and taxes are seeded for it', (await fresh.get('/construction/roles')).json.length === 17 && (await fresh.get('/construction/compliance/limits')).json.length === 24 && (await fresh.get('/construction/settings/tax')).json.length === 15);

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
    await sql.query(`DELETE FROM con_subcontracts WHERE "projectId" = $1 AND "partyId" IN (SELECT id FROM con_parties WHERE name LIKE 'Okoth Plumbing %')`, [sid]);
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
  check('the QS lets a subcontract (SC-00n, 10% retention, 5% cap)', sc.status === 201 && /^SC-\d{3}$/.test(sc.json.ref) && Number(sc.json.retentionRate) === 10, sc.json);
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

  section('13f. Casual payroll and the external portal (C6)');
  await sql.query(`DELETE FROM con_payroll_runs WHERE "projectId" = $1 AND number <> 'PAY-001'`, [sid]);
  await sql.query('DELETE FROM con_payout_settings WHERE "organizationId" = $1', [orgId]);
  await sql.query(`DELETE FROM con_tax_settings WHERE "organizationId" = $1 AND notes = 'e2e'`, [orgId]);
  await sql.query(`DELETE FROM con_portal_users WHERE "organizationId" = $1 AND email LIKE '%@e2e.test'`, [orgId]);
  await sql.query(`UPDATE con_portal_users SET "isActive" = true WHERE "organizationId" = $1`, [orgId]);
  const P = `/construction/projects/${sid}`;
  const runs0 = (await pm.get(`${P}/payroll-runs`)).json;
  check('seeded PAY-001 is paid for 15 workers', runs0.some((r) => r.number === 'PAY-001' && r.status === 'PAID' && r.workers === 15), runs0);
  check('the site supervisor cannot see payroll', (await siteUser.get(`${P}/payroll-runs`)).status === 403);
  check('the PM can see but not prepare a pay run', (await pm.post(`${P}/payroll-runs`, { periodStart: nairobi(-3), periodEnd: nairobi(-1) })).status === 403);
  check('a pay run cannot include tomorrow', (await acc.post(`${P}/payroll-runs`, { periodStart: nairobi(-1), periodEnd: nairobi(1) })).status === 400);
  check('a pay run covers at most 31 days', (await acc.post(`${P}/payroll-runs`, { periodStart: nairobi(-40), periodEnd: nairobi(-1) })).status === 400);
  check('days already paid in PAY-001 cannot be paid again', (await acc.post(`${P}/payroll-runs`, { periodStart: nairobi(-5), periodEnd: nairobi(-1) })).status === 409);
  await sql.query(`INSERT INTO con_tax_settings (id, "organizationId", key, rate, active, "effectiveFrom", notes) VALUES ($1, $2, 'HOUSING_LEVY', 2, true, $3, 'e2e')`, [randomUUIDish(), orgId, nairobi(-2)]);
  const run = await acc.post(`${P}/payroll-runs`, { periodStart: nairobi(-3), periodEnd: nairobi(-1) });
  check('accounts makes PAY-002 from the muster roll', run.status === 201 && run.json.number === 'PAY-002' && run.json.status === 'DRAFT' && run.json.workers >= 10, run.json);
  const line0 = run.json.lines?.[0] ?? {};
  check('pay = days present x daily rate (half days count half)', run.json.lines.every((l) => near(l.gross, r2(l.days * l.dailyRate))) && run.json.lines.some((l) => l.days % 1 === 0.5));
  check('NSSF 6% up to the ceiling scaled to 3 days, SHIF 2.75% (min scaled), housing levy at the new 2% rate', run.json.lines.every((l) => near(l.nssf, r2(Math.min(l.gross, 7200) * 0.06)) && near(l.shif, r2(Math.max(l.gross * 0.0275, 30))) && near(l.housingLevy, r2(l.gross * 0.02))), line0);
  check('net = gross - deductions, and the totals add up', run.json.lines.every((l) => near(l.net, r2(l.gross - l.nssf - l.shif - l.housingLevy - l.paye))) && near(run.json.net, r2(run.json.lines.reduce((a, l) => a + l.net, 0))));
  check('worker phone numbers are masked', run.json.lines.every((l) => !l.phone || l.phone.includes('*')));
  check('whoever prepared the run cannot approve it', (await acc.post(`${P}/payroll-runs/${run.json.id}/approve`, {})).status === 403);
  check('it cannot be paid before approval', (await acc.post(`${P}/payroll-runs/${run.json.id}/pay`, { method: 'CASH' })).status === 409);
  check('the Director approves it', (await dir.post(`${P}/payroll-runs/${run.json.id}/approve`, {})).json.status === 'APPROVED');
  check('an approved run cannot be deleted', (await acc.del(`${P}/payroll-runs/${run.json.id}`)).status === 409);
  check('M-Pesa needs the payout account set up first', (await acc.post(`${P}/payroll-runs/${run.json.id}/pay`, { method: 'MPESA' })).status === 409);
  check('a hand-made M-Pesa payment needs its code', (await acc.post(`${P}/payroll-runs/${run.json.id}/pay`, { method: 'MPESA_MANUAL' })).status === 400);
  check('the PM cannot set the payout account', (await pm.put('/construction/payroll/settings', { environment: 'sandbox', shortcode: '600000', initiator: 'testapi' })).status === 403);
  const payout = await acc.put('/construction/payroll/settings', { environment: 'sandbox', shortcode: '600000', initiator: 'testapi', consumerKey: `ck-${tag}`, consumerSecret: 'cs-secret', securityCredential: 'sec-cred' });
  check('accounts saves the business\'s own B2C account', payout.status === 200 && payout.json.ready === true && !JSON.stringify(payout.json).includes(`ck-${tag}`), payout.json);
  const stored = (await sql.query('SELECT "consumerKeyEncrypted" FROM con_payout_settings WHERE "organizationId" = $1', [orgId])).rows[0];
  check('the keys are stored encrypted', stored.consumerKeyEncrypted.startsWith('v1:') && !stored.consumerKeyEncrypted.includes(`ck-${tag}`));
  const [failW, noPhoneW] = [run.json.lines[1], run.json.lines[2]];
  const oldPhones = (await sql.query('SELECT id, phone FROM con_workers WHERE id = ANY($1)', [[failW.workerId, noPhoneW.workerId]])).rows;
  await sql.query(`UPDATE con_workers SET phone = '0712000999' WHERE id = $1`, [failW.workerId]);
  await sql.query('UPDATE con_workers SET phone = NULL WHERE id = $1', [noPhoneW.workerId]);
  const sent = await acc.post(`${P}/payroll-runs/${run.json.id}/pay`, { method: 'MPESA' });
  check('accounts pays by M-Pesa: sent to everyone with a number', sent.status === 200 && sent.json.skipped?.length === 1 && sent.json.lines.filter((l) => l.status === 'SENDING').length === run.json.lines.length - 1, sent.json.skipped);
  await sleep(2500);
  const runAfter = (await acc.get(`${P}/payroll-runs/${run.json.id}`)).json;
  const paidM = runAfter.lines.filter((l) => l.status === 'PAID');
  check('Safaricom\'s results settle the payments with M-Pesa receipts', paidM.length === run.json.lines.length - 2 && paidM.every((l) => l.method === 'MPESA' && /^[A-Z0-9]{10}$/.test(l.reference ?? '')), runAfter.lines.map((l) => [l.status, l.reference]));
  check('a refused payment and a missing number show as failed, the run stays open', runAfter.status === 'APPROVED' && runAfter.lines.find((l) => l.id === failW.id)?.failureReason && runAfter.lines.find((l) => l.id === noPhoneW.id)?.failureReason === 'No valid M-Pesa number on file', runAfter.lines.filter((l) => l.status !== 'PAID'));
  check('a result with the wrong secret is refused', (await call('POST', `/public/construction/payroll/mpesa-b2c/${orgId}/wrong-secret/result`, { body: {} })).status === 403);
  const cash = await acc.post(`${P}/payroll-runs/${run.json.id}/pay`, { method: 'CASH', reference: 'PV-0100', lineIds: [failW.id, noPhoneW.id] });
  check('the two left are paid in cash: the run is PAID', cash.json.status === 'PAID' && cash.json.lines.every((l) => l.status === 'PAID'), cash.json.status);
  check('nothing more to pay', (await acc.post(`${P}/payroll-runs/${run.json.id}/pay`, { method: 'CASH' })).status === 409);
  for (const w of oldPhones) await sql.query('UPDATE con_workers SET phone = $2 WHERE id = $1', [w.id, w.phone]);
  await sql.query(`DELETE FROM con_tax_settings WHERE "organizationId" = $1 AND notes = 'e2e'`, [orgId]);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_MJENGO' WHERE "organizationId" = $1`, [orgId]);
  const mjPay = await acc.get(`${P}/payroll-runs`);
  check('Mjengo has no M-Pesa payroll (upgrade prompt)', mjPay.status === 402 && mjPay.json.feature === 'payroll', mjPay.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);

  const staffBefore = Number((await sql.query('SELECT count(*) FROM org_users WHERE "organizationId" = $1', [orgId])).rows[0].count);
  check('the QS cannot give portal access', (await qs.post('/construction/portal-users', { name: 'X Y', email: `x-${tag}@e2e.test`, role: 'CON_CLIENT', projectIds: [sid] })).status === 403);
  const invited = await pm.post('/construction/portal-users', { name: 'Client Rep', email: `Client-${tag}@e2e.test`, role: 'CON_CLIENT', projectIds: [sid] });
  check('the PM invites the client\'s representative to the portal', invited.status === 201 && invited.json.email === `client-${tag}@e2e.test`, invited.json);
  check('the same email cannot be invited twice', (await pm.post('/construction/portal-users', { name: 'Client Rep', email: `client-${tag}@e2e.test`, role: 'CON_CLIENT', projectIds: [sid] })).status === 409);
  check('a subcontractor login must belong to a subcontractor', (await pm.post('/construction/portal-users', { name: 'Sub Guy', email: `sub-${tag}@e2e.test`, role: 'CON_SUBCONTRACTOR', projectIds: [sid] })).status === 409);
  const otherProject = (await sql.query(`SELECT id FROM con_projects WHERE "organizationId" = $1 AND id <> $2 AND id NOT IN (SELECT m."projectId" FROM con_project_members m JOIN org_users ou ON ou.id = m."orgUserId" JOIN users u ON u.id = ou."userId" WHERE u.email = 'pm@uriri.demo') LIMIT 1`, [orgId, sid])).rows[0].id;
  check('the PM cannot give access to a project they do not manage', (await pm.post('/construction/portal-users', { name: 'Other Rep', email: `other-${tag}@e2e.test`, role: 'CON_CLIENT', projectIds: [otherProject] })).status === 403);
  check('portal users are free: no staff login was added', Number((await sql.query('SELECT count(*) FROM org_users WHERE "organizationId" = $1', [orgId])).rows[0].count) === staffBefore);

  check('an unknown email gets the same answer and no code', JSON.stringify((await call('POST', '/construction-portal/auth/request-code', { body: { email: `nobody-${tag}@e2e.test` } })).json) === '{"sent":true}');
  const asked = await call('POST', '/construction-portal/auth/request-code', { body: { email: 'CQS@uriri.demo' } });
  check('the client\'s QS asks for a code (shown on screen when email is not set up)', asked.status === 200 && /^\d{6}$/.test(asked.json.devCode ?? ''), asked.json);
  check('a wrong code is refused', (await call('POST', '/construction-portal/auth/verify', { body: { email: 'cqs@uriri.demo', code: asked.json.devCode === '000000' ? '111111' : '000000' } })).status === 401);
  const signedIn = await call('POST', '/construction-portal/auth/verify', { body: { email: 'cqs@uriri.demo', code: asked.json.devCode } });
  check('the right code signs them in to Uriri Builders', signedIn.status === 200 && signedIn.json.accounts?.[0]?.organization === 'Uriri Builders Ltd', signedIn.json);
  check('a code works once', (await call('POST', '/construction-portal/auth/verify', { body: { email: 'cqs@uriri.demo', code: asked.json.devCode } })).status === 401);
  const portalSecret = readEnv(path.join(API_DIR, '.env.con-test')).BUYER_JWT_SECRET || live.BUYER_JWT_SECRET;
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mint = (sub) => {
    const head = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub, org: orgId, scope: 'con-portal', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${head}.${require('crypto').createHmac('sha256', portalSecret).update(head).digest('base64url')}`;
  };
  const portalIds = Object.fromEntries((await sql.query('SELECT email, id FROM con_portal_users WHERE "organizationId" = $1', [orgId])).rows.map((r) => [r.email, r.id]));
  const cqs = as(signedIn.json.accounts[0].token);
  const client = as(mint(portalIds[`client-${tag}@e2e.test`]));
  const arch = as(mint(portalIds['arch@uriri.demo']));
  const sub = as(mint(portalIds['sub@uriri.demo']));
  const PP = `/construction-portal/projects/${sid}`;

  const cme = await client.get('/construction-portal/me');
  check('the client sees only the project they were given', cme.status === 200 && cme.json.projects.length === 1 && cme.json.projects[0].id === sid && cme.json.organization.name === 'Uriri Builders Ltd', cme.json);
  const cOver = await client.get(PP);
  check('progress, milestones and the contract sum', cOver.status === 200 && cOver.json.milestones.length > 0 && cOver.json.progress >= 0 && cOver.json.contractSum > 0, cOver.json);
  for (const [what, url] of [['project', `/construction-portal/projects/${otherProject}`], ['photos', `/construction-portal/projects/${otherProject}/photos`], ['IPCs', `/construction-portal/projects/${otherProject}/valuations`], ['variations', `/construction-portal/projects/${otherProject}/variations`]]) {
    check(`another project's ${what} are not found for the client (404)`, (await client.get(url)).status === 404);
  }
  check("another project's subcontracts are not found for the subcontractor (404)", (await sub.get(`/construction-portal/projects/${otherProject}/subcontracts`)).status === 404);
  const freshProject = (await fresh.get('/construction/projects')).json?.[0];
  if (freshProject) check("another builder's project is not found (404)", (await client.get(`/construction-portal/projects/${freshProject.id}`)).status === 404);
  check('a staff token does not open the portal', (await call('GET', '/construction-portal/me', { token: dir._token })).status === 401);
  check('a portal token does not open staff screens', (await call('GET', '/construction/me', { token: client._token })).status === 401);
  const forged = mint(portalIds['arch@uriri.demo']).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  check('a tampered token is refused', (await call('GET', '/construction-portal/me', { token: forged })).status === 401);

  const cPhotos = await client.get(`${PP}/photos`);
  check('the client sees site photos', cPhotos.status === 200 && Array.isArray(cPhotos.json), cPhotos.json);
  if (cPhotos.json[0]) check('...and can open one', (await call('GET', `${PP}/photos/${cPhotos.json[0].id}/file`, { token: client._token })).type?.startsWith('image/'));
  const cVals = (await client.get(`${PP}/valuations`)).json;
  check('the client sees IPCs but never a draft', cVals.length >= 2 && cVals.every((v) => v.status !== 'DRAFT'), cVals.map((v) => [v.number, v.status]));
  const everything = JSON.stringify([cme.json, cOver.json, cPhotos.json, cVals, (await client.get(`${PP}/variations`)).json, (await client.get(`${PP}/instructions`)).json]);
  const someWorker = (await sql.query('SELECT name, "idNo", phone FROM con_workers WHERE "projectId" = $1 LIMIT 1', [sid])).rows[0];
  check('no worker personal data or internal costs reach the portal', !everything.includes(someWorker.name) && !everything.includes(someWorker.idNo) && !everything.includes(someWorker.phone) && !/dailyRate|idNo|"rate"|lpo|plant|payroll/i.test(everything));
  check('the subcontractor does not see the main contract sum or IPCs', (await sub.get(PP)).json.contractSum === null && (await sub.get(`${PP}/valuations`)).status === 403);
  check('the client cannot certify', (await client.post(`${PP}/valuations/${cVals[0].id}/certify`, {})).status === 403);

  const draft5 = (await qs.get(`${P}/valuations`)).json.find((v) => v.status === 'DRAFT');
  check('the Director sends draft IPC 5 to the client\'s QS', draft5 && (await dir.post(`${P}/valuations/${draft5.id}/submit`, {})).json.status === 'SUBMITTED');
  const seen = await cqs.get(`${PP}/valuations/${draft5.id}`);
  check('the client\'s QS opens it with its lines and can certify it', seen.status === 200 && seen.json.canCertify && seen.json.lines.length > 5, seen.json.canCertify);
  const certified = await cqs.post(`${PP}/valuations/${draft5.id}/certify`, { certifiedRef: `LQS/${tag}` });
  check('the client\'s QS certifies it from the portal, in their own name', certified.status === 200 && certified.json.status === 'CERTIFIED' && certified.json.certifiedByName === 'QS M. Akinyi', certified.json);
  const certAudit = (await sql.query(`SELECT "actorId", after FROM audit_log WHERE "organizationId" = $1 AND action = 'con_valuation.certified' AND "entityId" = $2`, [orgId, draft5.id])).rows[0];
  check('the audit log names the portal user', certAudit && certAudit.actorId === null && certAudit.after.externalActor === `portal:${portalIds['cqs@uriri.demo']}`, certAudit);
  check('a certified IPC cannot be certified again', (await cqs.post(`${PP}/valuations/${draft5.id}/certify`, {})).status === 409);

  const voP = await pm.post(`${P}/variations`, { description: `Portal VO ${tag}`, amount: 45000 });
  check('the client cannot approve variations', (await client.post(`${PP}/variations/${voP.json.id}/decision`, { decision: 'APPROVE' })).status === 403);
  const archOk = await arch.post(`${PP}/variations/${voP.json.id}/decision`, { decision: 'APPROVE' });
  check('the client\'s architect approves a variation from the portal', archOk.status === 200 && archOk.json.status === 'APPROVED', archOk.json);
  check('...recorded as approved by the architect', (await pm.get(`${P}/variations`)).json.find((v) => v.id === voP.json.id)?.approvedByName === 'Arch. P. Ochieng');
  const si = await arch.post(`${PP}/instructions`, { description: `Provide extra vent blocks ${tag}` });
  check('the architect issues a site instruction', si.status === 201 && /^SI-\d{3}$/.test(si.json.number), si.json);
  check('...which the site team sees, from the architect\'s firm', (await pm.get(`${P}/instructions`)).json.find((i) => i.id === si.json.id)?.issuedBy === 'Ochieng & Associates Architects');
  check('the client\'s QS cannot issue instructions', (await cqs.post(`${PP}/instructions`, { description: 'Nope nope' })).status === 403);

  const subs = (await sub.get(`${PP}/subcontracts`)).json;
  check('the subcontractor sees only their own subcontract and payments', subs.length === 1 && subs[0].paid === 288000 && subs[0].valuations[0].paymentRef === 'EFT/NPW/0013', subs);
  const sv = await sub.post(`${PP}/subcontracts/${subs[0].id}/valuations`, { grossToDate: 500000, notes: 'First fix complete' });
  check('the subcontractor submits valuation 2: 500,000 less 50,000 retention less 288,000 paid', sv.status === 201 && sv.json.netDue === 162000 && sv.json.status === 'DRAFT', sv.json);
  const okothSub = (await sql.query(`SELECT s.id FROM con_subcontracts s JOIN con_parties p ON p.id = s."partyId" WHERE s."projectId" = $1 AND p.name LIKE 'Okoth Plumbing %' LIMIT 1`, [sid])).rows[0];
  if (okothSub) check("they cannot value someone else's subcontract", (await sub.post(`${PP}/subcontracts/${okothSub.id}/valuations`, { grossToDate: 1 })).status === 404);
  await sql.query('UPDATE con_subscriptions SET "planCode" = \'CON_PRO\' WHERE "organizationId" = $1', [orgId]);
  check('the Director approves the subcontractor\'s valuation', (await dir.post(`${P}/subcontracts/${subs[0].id}/valuations/${sv.json.id}/approve`, {})).json.status === 'APPROVED');
  await sql.query('DELETE FROM con_sub_valuations WHERE id = $1', [sv.json.id]);
  await sql.query('UPDATE con_subscriptions SET "planCode" = \'CON_FUNDI\' WHERE "organizationId" = $1', [orgId]);
  check('on a plan without the portal it is switched off', (await client.get('/construction-portal/me')).status === 403);
  await sql.query('UPDATE con_subscriptions SET "planCode" = \'CON_CONTRACTOR\' WHERE "organizationId" = $1', [orgId]);
  check('the PM removes the client rep\'s access', (await pm.put(`/construction/portal-users/${invited.json.id}`, { isActive: false })).json.isActive === false);
  check('their token stops working at once', (await client.get('/construction-portal/me')).status === 401);
  const c6audit = (await sql.query(`SELECT DISTINCT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'con_%'`, [orgId])).rows.map((r) => r.action);
  for (const a of ['con_payroll.created', 'con_payroll.approved', 'con_payroll.mpesa_sent', 'con_payroll.mpesa_paid', 'con_payroll.mpesa_failed', 'con_payroll.paid', 'con_payout_settings.updated', 'con_portal_user.invited', 'con_portal_user.updated', 'con_instruction.created']) {
    check(`audit: ${a}`, c6audit.includes(a));
  }

  section('13g. Reports, dashboards and hardening (C7)');
  const RP = '/construction/reports';
  const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100;
  const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;
  const catDir = await dir.get(RP);
  check('the Director sees all 8 reports, none locked on Contractor', catDir.json.length === 8 && catDir.json.every((c) => !c.locked), catDir.json);
  check('the storekeeper has no reports', (await store.get(RP)).status === 403);
  const qsKeys = (await qs.get(RP)).json.map((c) => c.key);
  check("the QS sees money reports but not labour cost", qsKeys.includes('cost') && qsKeys.includes('ipc') && !qsKeys.includes('labour') && (await qs.get(`${RP}/labour`)).status === 403, qsKeys);
  const compKeys = (await comp.get(RP)).json.map((c) => c.key);
  check('the compliance officer sees compliance, safety and NCA, not cost', compKeys.includes('compliance') && compKeys.includes('nca') && !compKeys.includes('cost') && (await comp.get(`${RP}/cost`)).status === 403, compKeys);

  const costR = await dir.get(`${RP}/cost?projectId=${sid}`);
  const cr = costR.json.rows?.[0];
  const proj = (await dir.get(`/construction/projects/${sid}`)).json;
  check('cost report: budget is the revised (else contract) sum', costR.status === 200 && cr && cr.budget === (proj.revisedSum ?? proj.contractSum), cr);
  const branch = (await sql.query('SELECT "branchId" FROM con_projects WHERE id = $1', [sid])).rows[0].branchId;
  const grn = Number((await sql.query('SELECT COALESCE(SUM(l."quantityAccepted" * COALESCE(l."unitCost", 0)), 0) AS v FROM goods_receipt_lines l JOIN goods_receipts g ON g.id = l."receiptId" WHERE g."branchId" = $1', [branch])).rows[0].v);
  check('...materials = delivered value at the site store', cr && close(cr.materials, grn) && grn > 0, { report: cr?.materials, grn });
  check('...plant = the plant cost screen', cr && close(cr.plant, (await dir.get(`/construction/projects/${sid}/plant-cost`)).json.total));
  const labourSql = (await sql.query(`
    SELECT COALESCE((SELECT SUM(l.gross) FROM con_payroll_lines l JOIN con_payroll_runs r ON r.id = l."runId" WHERE r."projectId" = $1 AND r.status <> 'DRAFT'), 0)
         + COALESCE((SELECT SUM(CASE m.status WHEN 'PRESENT' THEN 1 ELSE 0.5 END * w."dailyRate") FROM con_muster m JOIN con_workers w ON w.id = m."workerId"
                      WHERE m."projectId" = $1 AND m.status <> 'ABSENT' AND NOT EXISTS (SELECT 1 FROM con_payroll_runs r WHERE r."projectId" = $1 AND r.status <> 'DRAFT' AND m.date BETWEEN r."periodStart" AND r."periodEnd")), 0) AS v`, [sid])).rows[0].v;
  check('...labour = pay runs + muster days not yet on a pay run', cr && close(cr.labour, labourSql) && cr.labour > 0, { report: cr?.labour, sql: labourSql });
  check('...cost adds up and margin = certified - cost', cr && close(cr.cost, cr.materials + cr.labour + cr.plant + cr.subcontracts) && close(cr.margin, cr.certified - cr.cost) && cr.certified > 0, cr);

  const ipcR = (await dir.get(`${RP}/ipc?projectId=${sid}`)).json.rows[0];
  const received = Number((await sql.query(`SELECT COALESCE(SUM(r.amount), 0) AS v FROM con_valuation_receipts r JOIN con_valuations v ON v.id = r."valuationId" WHERE v."projectId" = $1 AND r.kind = 'PAYMENT'`, [sid])).rows[0].v);
  check('IPC report: received and retention held match the ledgers', ipcR && close(ipcR.received, received) && close(ipcR.retentionHeld, (await dir.get(`/construction/projects/${sid}/retention`)).json.held), ipcR);
  const matR = (await dir.get(`${RP}/materials?projectId=${sid}`)).json;
  const recon = (await dir.get(`/construction/projects/${sid}/reconciliation`)).json;
  check('material report = the reconciliation screen', matR.rows.length === recon.length && close(sum(matR.rows, 'unaccounted'), recon.reduce((a, r) => a + r.unaccounted, 0)), { report: matR.rows.length, recon: recon.length });
  const labR = (await dir.get(`${RP}/labour?projectId=${sid}`)).json.rows[0];
  const days = Number((await sql.query(`SELECT COALESCE(SUM(CASE status WHEN 'PRESENT' THEN 1 WHEN 'HALF' THEN 0.5 ELSE 0 END), 0) AS v FROM con_muster WHERE "projectId" = $1`, [sid])).rows[0].v);
  const netPaid = Number((await sql.query(`SELECT COALESCE(SUM(l.net), 0) AS v FROM con_payroll_lines l JOIN con_payroll_runs r ON r.id = l."runId" WHERE r."projectId" = $1 AND l.status = 'PAID'`, [sid])).rows[0].v);
  check('labour report: worker-days and net paid match the muster and pay runs', labR && close(labR.days, days) && close(labR.paid, netPaid) && close(labR.cost, cr.labour), labR);
  const cashR = (await dir.get(`${RP}/cashflow?projectId=${sid}`)).json;
  const inSql = Number((await sql.query(`SELECT COALESCE(SUM(r.amount), 0) AS v FROM con_valuation_receipts r JOIN con_valuations v ON v.id = r."valuationId" WHERE v."projectId" = $1 AND r.kind = 'PAYMENT' AND r."receivedAt" >= date_trunc('month', now() - interval '335 days')`, [sid])).rows[0].v);
  check('cash flow: money in = IPC payments in the last 12 months, running balance adds up', close(cashR.totals?.inflow ?? 0, inSql) && close(cashR.rows.at(-1)?.running ?? 0, (cashR.totals?.inflow ?? 0) - (cashR.totals?.outflow ?? 0)), cashR.totals);
  const safR = (await dir.get(`${RP}/safety?projectId=${sid}`)).json.rows[0];
  const lt = Number((await sql.query(`SELECT count(*) FROM con_incidents WHERE "projectId" = $1 AND severity IN ('LOST_TIME', 'FATAL')`, [sid])).rows[0].count);
  check('safety report: lost-time and fatal incidents counted, LTIFR from hours worked', safR && safR.lostTime + safR.fatal === lt && safR.hours > 0 && (lt === 0 || safR.ltifr > 0), safR);
  check('...a date range with nothing in it shows nothing', (await dir.get(`${RP}/safety?projectId=${sid}&from=2020-01-01&to=2020-01-31`)).json.rows[0].nearMiss === 0);
  const compR = (await dir.get(`${RP}/compliance`)).json;
  const daysLeftList = compR.rows.filter((r) => r.daysLeft !== null).map((r) => r.daysLeft);
  check('compliance report lists documents, licences, permits and cards, soonest first', compR.rows.some((r) => r.area === 'Company document') && compR.rows.some((r) => r.area === 'NCA licence') && daysLeftList.every((d, i) => i === 0 || d >= daysLeftList[i - 1]), compR.rows.length);
  const ncaR = (await dir.get(`${RP}/nca`)).json.rows;
  const bld = ncaR.find((r) => r.worksClass === 'Building works');
  const capRow = (await sql.query(`SELECT l."maxValue" FROM con_category_limits l JOIN con_company_registrations g ON g."organizationId" = l."organizationId" AND g."worksClass" = l."worksClass" AND g."ncaCategory" = l."ncaCategory" WHERE l."organizationId" = $1 AND l."worksClass" = 'BUILDING'`, [orgId])).rows[0];
  check('NCA utilisation: the Building cap and the biggest open contract against it', bld && Number(bld.cap) === Number(capRow?.maxValue) && bld.largest >= (proj.revisedSum ?? proj.contractSum) && bld.used > 0, bld);

  const notPm = (await sql.query(`SELECT p.id FROM con_projects p WHERE p."organizationId" = $1 AND NOT EXISTS (SELECT 1 FROM con_project_members m JOIN org_users ou ON ou.id = m."orgUserId" JOIN users u ON u.id = ou."userId" WHERE m."projectId" = p.id AND u.email = 'pm@uriri.demo') LIMIT 1`, [orgId])).rows[0];
  const pmCost = (await pm.get(`${RP}/cost`)).json;
  const pmProjects = (await pm.get('/construction/projects')).json.map((p) => p.code);
  check("the PM's reports cover only the PM's projects", pmCost.rows.length > 0 && pmCost.rows.every((r) => pmProjects.includes(r.code)), pmCost.rows.map((r) => r.code));
  if (notPm) check("...and refuse a project the PM is not on", (await pm.get(`${RP}/cost?projectId=${notPm.id}`)).status === 403);
  check("...and leave out company documents", (await pm.get(`${RP}/compliance`)).json.rows.every((r) => r.area !== 'Company document'));
  check('another business gets no rows and cannot ask for Uriri\'s project', (await fresh.get(`${RP}/cost`)).json.rows.length === 0 && (await fresh.get(`${RP}/cost?projectId=${sid}`)).status === 404);

  const xlsx = await dir.get(`${RP}/cost?format=xlsx`);
  check('Excel export downloads a real spreadsheet', xlsx.status === 200 && /spreadsheetml/.test(xlsx.type) && xlsx.buf.subarray(0, 2).toString() === 'PK', xlsx.type);
  const wbx = new Workbook();
  await wbx.xlsx.load(xlsx.buf);
  check('...with the company, title and the projects', wbx.worksheets[0].getCell('A1').value && wbx.worksheets[0].getCell('A2').value === 'Project cost vs BQ budget' && wbx.worksheets[0].rowCount >= 6);
  for (const [q, why] of [['/cost?from=2026-13-01', 'a bad date'], ['/cost?projectId=nope', 'a bad project id'], ['/cost?format=pdf', 'an unknown format'], ['/cost?colour=red', 'an unknown field']]) {
    check(`reports refuse ${why} (400)`, (await dir.get(`${RP}${q}`)).status === 400);
  }
  check('an unknown report is 404 (even a JavaScript name)', (await dir.get(`${RP}/nope`)).status === 404 && (await dir.get(`${RP}/toString`)).status === 404);

  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_FUNDI' WHERE "organizationId" = $1`, [orgId]);
  const fundiCat = (await dir.get(RP)).json;
  check('on Fundi, cash flow, labour and NCA reports are locked', ['cashflow', 'labour', 'nca'].every((k) => fundiCat.find((c) => c.key === k)?.locked) && !fundiCat.find((c) => c.key === 'cost').locked);
  const locked = await dir.get(`${RP}/cashflow`);
  check('...asking for one says which plan to upgrade to (402)', locked.status === 402 && locked.json.upgrade === true && locked.json.requiredPlan === 'CON_CONTRACTOR', locked.json);
  check('...basic reports still run', (await dir.get(`${RP}/cost`)).status === 200);
  check('...but Excel and print need the upgrade', (await dir.get(`${RP}/cost?format=xlsx`)).status === 402 && (await dir.get(`${RP}/cost?format=print`)).status === 402);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR', "currentPeriodEnd" = now() - interval '30 days' WHERE "organizationId" = $1`, [orgId]);
  check('a suspended (read-only) business can still run and export reports', (await dir.get('/construction/me')).json.status === 'SUSPENDED' && (await dir.get(`${RP}/cost?format=xlsx`)).status === 200);
  await sql.query(`UPDATE con_subscriptions SET "currentPeriodEnd" = now() + interval '30 days' WHERE "organizationId" = $1`, [orgId]);

  const dd = await dir.get('/construction/dashboard/director');
  const openCount = Number((await sql.query(`SELECT count(*) FROM con_projects WHERE "organizationId" = $1 AND status <> 'CLOSED'`, [orgId])).rows[0].count);
  const awaiting = Number((await sql.query(`SELECT count(*) FROM con_lpos l JOIN con_projects p ON p.id = l."projectId" WHERE l."organizationId" = $1 AND l.status = 'AWAITING_APPROVAL' AND p.status <> 'CLOSED'`, [orgId])).rows[0].count);
  check('Director dashboard: every open project, LPOs waiting and totals', dd.status === 200 && dd.json.projects.length === openCount && dd.json.approvals.lpos === awaiting && close(dd.json.totals.cost, sum(dd.json.projects, 'cost')), dd.json.totals);
  check('...its project row agrees with the cost report', close(dd.json.projects.find((p) => p.id === sid)?.cost, cr.cost));
  check('the PM cannot open the Director dashboard', (await pm.get('/construction/dashboard/director')).status === 403);
  const pmDash = await pm.get(`/construction/projects/${sid}/dashboard`);
  check('PM dashboard: programme, today, approvals, safety and money', pmDash.status === 200 && typeof pmDash.json.programme.progress === 'number' && pmDash.json.money && close(pmDash.json.money.cost, cr.cost) && pmDash.json.today.present >= 0, pmDash.json.programme);
  const storeDash = await store.get(`/construction/projects/${sid}/dashboard`);
  check('the storekeeper sees the project dashboard without the money', storeDash.status === 200 && storeDash.json.money === null);
  if (notPm) check("the PM cannot open the dashboard of another project", (await pm.get(`/construction/projects/${notPm.id}/dashboard`)).status === 403);

  const storeProj = (await store.get(`/construction/projects/${sid}`)).json;
  check('storekeepers see their project without contract money, client or consultants', storeProj.code && storeProj.contractSum === null && storeProj.client === null && storeProj.parties.length === 0, storeProj);
  check('...and cannot list clients and consultants', (await store.get('/construction/parties')).status === 403);
  check('the site supervisor still sees the contract sum', typeof (await siteUser.get(`/construction/projects/${sid}`)).json.contractSum === 'number');

  const forbidden = [
    [store, 'storekeeper', [`/construction/projects/${sid}/payroll-runs`, `/construction/projects/${sid}/valuations`, `/construction/projects/${sid}/variations`, '/construction/tenders', '/construction/compliance/docs', '/construction/workers', `/construction/projects/${sid}/safety`, `/construction/projects/${sid}/diaries`, '/construction/payroll/settings', '/construction/staff']],
    [siteUser, 'site supervisor', [`/construction/projects/${sid}/payroll-runs`, `/construction/projects/${sid}/valuations`, `/construction/projects/${sid}/reconciliation`, '/construction/tenders', '/construction/compliance/docs', RP, '/construction/dashboard/director']],
    [qs, 'QS', [`/construction/projects/${sid}/payroll-runs`, '/construction/payroll/settings', '/construction/workers', `/construction/projects/${sid}/safety`, '/construction/staff']],
    [proc, 'procurement', [`/construction/projects/${sid}/valuations`, `/construction/projects/${sid}/payroll-runs`, '/construction/workers', `/construction/projects/${sid}/diaries`]],
    [comp, 'compliance', [`/construction/projects/${sid}/valuations`, `/construction/projects/${sid}/payroll-runs`, `/construction/projects/${sid}/variations`]],
  ];
  for (const [who, name, paths] of forbidden) {
    const leaks = [];
    for (const p of paths) if ((await who.get(p)).status !== 403) leaks.push(p);
    check(`the ${name} is refused (403) on ${paths.length} areas outside their role`, leaks.length === 0, leaks);
  }
  const writes = [
    [store, 'POST', `/construction/projects/${sid}/payroll-runs`, { periodStart: nairobi(-3), periodEnd: nairobi(-1) }],
    [siteUser, 'POST', `/construction/projects/${sid}/valuations`, { lines: [] }],
    [pm, 'POST', '/construction/staff', { email: `x-${tag}@test.local`, job: 'CON_QS' }],
    [qs, 'POST', `/construction/projects/${sid}/lpos/${randomUUIDish()}/approve`, {}],
    [proc, 'POST', '/construction/compliance/docs', { type: 'OTHER', title: 'No' }],
  ];
  for (const [who, m, p, body] of writes) check(`role check before anything else: ${m} ${p.replace(sid, ':id')} is 403`, (await call(m, p, { token: who._token, body })).status === 403);

  check('paging: take=1 returns at most one instruction', (await pm.get(`/construction/projects/${sid}/instructions?take=1`)).json.length <= 1);
  check('...skip moves on', (await pm.get(`/construction/projects/${sid}/instructions?take=1&skip=1`)).json[0]?.id !== (await pm.get(`/construction/projects/${sid}/instructions?take=1`)).json[0]?.id);
  for (const q of ['take=0', 'take=501', 'skip=-1', 'take=abc']) check(`paging refuses ${q}`, (await pm.get(`/construction/projects/${sid}/lpos?${q}`)).status === 400);
  check('worker filter refuses a bad project id', (await dir.get('/construction/workers?projectId=nope')).status === 400);
  check('muster refuses a bad date', (await pm.get(`/construction/projects/${sid}/muster?date=31-10-2026`)).status === 400);
  check('muster summary needs both dates', (await pm.get(`/construction/projects/${sid}/muster/summary?from=2026-10-01`)).status === 400);
  check('diaries refuse a bad date', (await pm.get(`/construction/projects/${sid}/diaries?from=yesterday`)).status === 400);
  check('a photo with an impossible GPS point is refused', (await call('POST', `/construction/projects/${sid}/photos?lat=123&lng=34`, { token: siteUser._token, raw: Buffer.from([0xff, 0xd8, 0xff]), headers: { 'Content-Type': 'image/jpeg' } })).status === 400);

  // Database-level isolation: a role without BYPASSRLS, the tenant set to one business, counts other businesses' rows in every con_ table.
  await sql.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'con_rls_probe') THEN CREATE ROLE con_rls_probe NOLOGIN; END IF; END $$`);
  await sql.query('GRANT USAGE ON SCHEMA public TO con_rls_probe; GRANT SELECT ON ALL TABLES IN SCHEMA public TO con_rls_probe');
  const conTables = (await sql.query(`SELECT c.table_name FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name LIKE 'con\\_%' AND c.column_name = 'organizationId' ORDER BY 1`)).rows.map((r) => r.table_name);
  const probe = async (tenant) => {
    const leaks = [];
    let own = 0;
    await sql.query('BEGIN');
    try {
      await sql.query('SET LOCAL ROLE con_rls_probe');
      if (tenant) await sql.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
      for (const t of conTables) {
        const r = (await sql.query(`SELECT count(*) FILTER (WHERE "organizationId" <> $1) AS other, count(*) AS total FROM "${t}"`, [tenant ?? ''])).rows[0];
        if (Number(r.other) > 0 && !(tenant === null && ['con_subscriptions', 'con_subscription_payments', 'con_fee_invoices'].includes(t))) leaks.push(`${t}:${r.other}`);
        own += Number(r.total);
      }
    } finally {
      await sql.query('ROLLBACK');
    }
    return { leaks, own };
  };
  const asUriri = await probe(orgId);
  check(`RLS: as Uriri, none of ${conTables.length} construction tables shows another business's rows`, conTables.length >= 48 && asUriri.leaks.length === 0 && asUriri.own > 0, asUriri.leaks);
  const asFresh = await probe(signup.json.organizationId);
  check("RLS: as the new business, none of Uriri's rows are visible", asFresh.leaks.length === 0, asFresh.leaks);
  const asNobody = await probe(null);
  check('RLS: with no business set, nothing is visible (except plan billing, for ZARODA admin)', asNobody.leaks.length === 0, asNobody.leaks);

  section('13h. Add-ons: extra project slots, SMS bundles, payout fees (C8)');
  const AD = '/construction/plan/addons';
  const PHONE = '0712345678';
  const unblock = () => sql.query(`UPDATE con_subscription_payments SET "createdAt" = now() - interval '5 minutes' WHERE "organizationId" = $1 AND status = 'PENDING'`, [orgId]);
  const payByMock = async (paymentId) => {
    const m = (await sql.query('SELECT "tumaMerchantRequestId" AS m FROM con_subscription_payments WHERE id = $1', [paymentId])).rows[0]?.m;
    await fetch(`${TUMA}/_test/pay/${m}`, { method: 'POST' });
    await sleep(400);
  };
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR', status = 'ACTIVE', "currentPeriodEnd" = (now() at time zone 'UTC') + interval '20 days' - interval '1 hour', addons = '{}' WHERE "organizationId" = $1`, [orgId]);
  let ad = (await dir.get(AD)).json;
  check('add-ons: SMS bundles, the payout fee table and extra slots on Contractor', ad.bundles.length >= 3 && ad.fees.bands.length >= 2 && ad.extraProjects.sold && ad.extraProjects.canBuy && ad.extraProjects.owned === 0, ad.extraProjects);
  check('...a slot bought today costs the 20 days left of KES 1,500 a month', ad.extraProjects.oneSlotNow === 1000, ad.extraProjects.oneSlotNow);

  await unblock();
  check('the storekeeper cannot buy add-ons', (await store.post('/construction/plan/extra-projects', { count: 1, phone: PHONE })).status === 403);
  const slot = await acc.post('/construction/plan/extra-projects', { count: 2, phone: PHONE });
  check('Accounts buys 2 extra project slots by M-Pesa (KES 2,000 for the 20 days)', slot.status === 201 && slot.json.status === 'PENDING' && slot.json.purpose === 'EXTRA_PROJECTS' && slot.json.amount === 2000, slot.json);
  const subBefore = (await sql.query('SELECT "currentPeriodEnd", "paidPaymentsCount" FROM con_subscriptions WHERE "organizationId" = $1', [orgId])).rows[0];
  await payByMock(slot.json.id);
  ad = (await dir.get(AD)).json;
  const subAfterSlots = (await sql.query('SELECT "currentPeriodEnd", "paidPaymentsCount" FROM con_subscriptions WHERE "organizationId" = $1', [orgId])).rows[0];
  check('once paid the project limit is 8, the paid-up date and plan payment count are untouched', ad.extraProjects.owned === 2 && ad.extraProjects.limit === 8 && +subAfterSlots.currentPeriodEnd === +subBefore.currentPeriodEnd && subAfterSlots.paidPaymentsCount === subBefore.paidPaymentsCount, { owned: ad.extraProjects.owned, limit: ad.extraProjects.limit });
  const renew = (await dir.get('/construction/plan/quote?planCode=CON_CONTRACTOR&cycle=MONTHLY')).json;
  check('...and the slots renew with the plan (9,500 + 2 x 1,500)', renew.extraProjects === 2 && renew.gross === 12500, renew);
  const giveBack = await acc.post('/construction/plan/extra-projects/remove', { count: 1 });
  if (ad.extraProjects.active <= 7) check('a slot can be given back while the open projects fit', giveBack.status === 200 && giveBack.json.extraProjects === 1, giveBack.json);
  else check('a slot cannot be given back while every slot is in use', giveBack.status === 409, giveBack.json);
  check('...never more than you have', (await acc.post('/construction/plan/extra-projects/remove', { count: 50 })).status === 400);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_FUNDI', addons = '{}' WHERE "organizationId" = $1`, [orgId]);
  const slotOffer = await qs.post('/construction/projects', { name: `Over limit ${tag}`, worksClass: 'BUILDING', contractSum: 1000000 });
  check('starting a project over the limit offers an extra slot (Fundi sells them)', slotOffer.status === 402 && slotOffer.json.buyExtra === true, slotOffer.json);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_MJENGO' WHERE "organizationId" = $1`, [orgId]);
  const overMj = await qs.post('/construction/projects', { name: `Over limit ${tag}`, worksClass: 'BUILDING', contractSum: 1000000 });
  check('...but Mjengo only offers the upgrade', overMj.status === 402 && overMj.json.buyExtra === false);
  await unblock();
  check('...and does not sell slots', (await acc.post('/construction/plan/extra-projects', { count: 1, phone: PHONE })).status === 400);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR', status = 'TRIAL' WHERE "organizationId" = $1`, [orgId]);
  await unblock();
  check('slots are added to a paid plan, not a trial', (await acc.post('/construction/plan/extra-projects', { count: 1, phone: PHONE })).status === 409);
  await sql.query(`UPDATE con_subscriptions SET status = 'ACTIVE' WHERE "organizationId" = $1`, [orgId]);

  await unblock();
  const smsBefore = (await dir.get(AD)).json.smsCredits;
  const smsBuy = await acc.post('/construction/plan/sms', { bundleCode: 'SMS_500', phone: PHONE });
  check('Accounts buys 500 texts', smsBuy.status === 201 && smsBuy.json.purpose === 'SMS' && smsBuy.json.amount === 500, smsBuy.json);
  await payByMock(smsBuy.json.id);
  check('...the SMS credit goes up by 500', (await dir.get(AD)).json.smsCredits === smsBefore + 500);
  check('an unknown bundle is refused', (await acc.post('/construction/plan/sms', { bundleCode: 'NOPE', phone: PHONE })).status === 404);

  const feeCharges = (await sql.query(`SELECT c.amount, l.net FROM con_fee_charges c JOIN con_payroll_lines l ON 'payout:' || l.id = c."sourceId" WHERE c."organizationId" = $1 AND l."paidAt" >= $2::timestamp`, [orgId, new Date(t0).toISOString().replace('T', ' ').replace('Z', '')])).rows;
  const mpesaPaid = Number((await sql.query(`SELECT count(*) FROM con_payroll_lines l JOIN con_payroll_runs r ON r.id = l."runId" WHERE r."organizationId" = $1 AND l.method = 'MPESA' AND l.status = 'PAID' AND l."paidAt" >= $2::timestamp`, [orgId, new Date(t0).toISOString().replace('T', ' ').replace('Z', '')])).rows[0].count);
  check('every wage paid by M-Pesa today carries one ZARODA payout fee', mpesaPaid > 0 && feeCharges.length === mpesaPaid, { charges: feeCharges.length, mpesaPaid });
  const bandRows = (await sql.query('SELECT "upTo", "darajaCost", markup FROM con_payout_fee_bands')).rows.map((b) => ({ upTo: b.upTo === null ? Infinity : Number(b.upTo), fee: Number(b.darajaCost) + Number(b.markup) })).sort((a, b) => a.upTo - b.upTo);
  check('...priced from the fee table by the amount paid', feeCharges.every((c) => close(c.amount, bandRows.find((b) => Number(c.net) <= b.upTo).fee)), feeCharges);
  const runView = (await acc.get(`${P}/payroll-runs/${run.json.id}`)).json;
  check('the pay run shows its payout fees and the texts left', runView.payoutFees.count >= 1 && runView.payoutFees.total > 0 && typeof runView.smsCredits === 'number', runView.payoutFees);

  const lm = new Date(Date.now() + 3 * 3600_000);
  lm.setUTCDate(1);
  lm.setUTCMonth(lm.getUTCMonth() - 1);
  const lastMonth = lm.toISOString().slice(0, 7);
  await sql.query('DELETE FROM con_fee_invoices WHERE "organizationId" = $1 AND "periodMonth" = $2', [orgId, lastMonth]);
  await sql.query('UPDATE con_fee_charges SET "periodMonth" = $2 WHERE "organizationId" = $1 AND "invoiceId" IS NULL', [orgId, lastMonth]);
  const feesOwed = Number((await sql.query('SELECT COALESCE(SUM(amount), 0) AS v FROM con_fee_charges WHERE "organizationId" = $1 AND "periodMonth" = $2', [orgId, lastMonth])).rows[0].v);
  ad = (await dir.get(AD)).json;
  const feeInv = ad.fees.invoices.find((i) => i.month === lastMonth);
  check("a finished month's fees become that month's invoice", feeInv && feeInv.status === 'UNPAID' && close(feeInv.total, feesOwed) && feesOwed > 0, { feeInv, feesOwed });
  check('...and this month starts again from nothing', ad.fees.thisMonth.count === 0);
  await unblock();
  const payFee = await acc.post(`/construction/plan/fees/${feeInv.id}/pay`, { phone: PHONE });
  check('Accounts pays the fee invoice by M-Pesa', payFee.status === 201 && payFee.json.purpose === 'FEES' && close(payFee.json.amount, feeInv.total), payFee.json);
  await payByMock(payFee.json.id);
  check('...it is marked PAID', (await dir.get(AD)).json.fees.invoices.find((i) => i.id === feeInv.id)?.status === 'PAID');
  check('a paid invoice cannot be paid again', (await acc.post(`/construction/plan/fees/${feeInv.id}/pay`, { phone: PHONE })).status === 409);
  check("another business cannot pay (or see) Uriri's invoice", (await fresh.post(`/construction/plan/fees/${feeInv.id}/pay`, { phone: PHONE })).status === 404);
  const purchaseAudit = (await sql.query(`SELECT count(*) FROM audit_log WHERE "organizationId" = $1 AND action = 'con_purchase.paid' AND "createdAt" >= $2::timestamp`, [orgId, new Date(t0).toISOString().replace('T', ' ').replace('Z', '')])).rows[0].count;
  check('audit: each paid add-on (slots, texts, fees) is logged', Number(purchaseAudit) >= 3, purchaseAudit);

  const priceLists = await admin.get('/platform-admin/construction/price-lists');
  check('ZARODA sees the price lists', priceLists.status === 200 && priceLists.json.bundles.some((b) => b.code === 'SMS_500') && priceLists.json.bands.filter((b) => b.upTo === null).length === 1);
  check('...the fee table needs exactly one open-ended band', (await admin.post('/platform-admin/construction/payout-fees', { bands: [{ darajaCost: 1, markup: 1 }, { darajaCost: 2, markup: 1 }] })).status === 400);
  const bandsSaved = await admin.post('/platform-admin/construction/payout-fees', { bands: priceLists.json.bands.map((b) => ({ upTo: b.upTo, darajaCost: b.darajaCost, markup: b.markup })) });
  check('...and saves a valid one', bandsSaved.status === 201 && bandsSaved.json.length === priceLists.json.bands.length, bandsSaved.json);
  const sms500 = priceLists.json.bundles.find((b) => b.code === 'SMS_500');
  check('ZARODA changes a bundle price', (await admin.post('/platform-admin/construction/sms-bundles', { ...sms500, id: undefined, price: 550 })).json.price == 550);
  await admin.post('/platform-admin/construction/sms-bundles', { ...sms500, id: undefined });
  check('staff cannot open the price lists', [401, 403].includes((await dir.get('/platform-admin/construction/price-lists')).status));
  check('the billing report shows unpaid payout fees', typeof (await admin.get('/platform-admin/construction/billing')).json.fees?.total === 'number');
  await sql.query(`UPDATE con_subscriptions SET addons = '{}' WHERE "organizationId" = $1`, [orgId]);

  section('13i. Construction in the general ledger (C8)');
  // earlier runs deleted demo rows they had posted: start Uriri's test books afresh so they mirror today's data exactly
  await sql.query('DELETE FROM journal_lines WHERE "organizationId" = $1', [orgId]);
  await sql.query('DELETE FROM ledger_postings WHERE "organizationId" = $1', [orgId]);
  await sql.query('DELETE FROM journal_entries WHERE "organizationId" = $1', [orgId]);
  const books = await dir.patch('/accounting/settings', { startDate: nairobi(-730) });
  check('the books start two years back so the demo history posts', books.status === 200, books.json);
  const posted = await dir.post('/accounting/post-now', {});
  check('the ledger posts', [200, 201].includes(posted.status), posted.json);
  const keyed = (await sql.query(`SELECT "systemKey" FROM ledger_accounts WHERE "organizationId" = $1 AND "systemKey" IN ('RETENTION_RECEIVABLE', 'RETENTION_PAYABLE', 'SUBCONTRACTORS')`, [orgId])).rows.map((r) => r.systemKey);
  check('construction businesses get retention (both ways) and subcontractor cost accounts', keyed.length === 3, keyed);
  const retailOrg = (await sql.query(`SELECT o.id FROM organizations o JOIN ledger_settings s ON s."organizationId" = o.id WHERE o."industryType" <> 'CONSTRUCTION' LIMIT 1`)).rows[0];
  if (retailOrg) check('...other businesses do not', Number((await sql.query(`SELECT count(*) FROM ledger_accounts WHERE "organizationId" = $1 AND "systemKey" = 'RETENTION_RECEIVABLE'`, [retailOrg.id])).rows[0].count) === 0);
  const balance = async (key) => Number((await sql.query(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN ledger_accounts a ON a.id = l."accountId" WHERE l."organizationId" = $1 AND a."systemKey" = $2`, [orgId, key])).rows[0].v);
  const postings = async (type) => Number((await sql.query(`SELECT count(*) FROM ledger_postings WHERE "organizationId" = $1 AND "sourceType" = $2 AND "entryId" IS NOT NULL`, [orgId, type])).rows[0].count);
  const heldSql = Number((await sql.query(`SELECT COALESCE(SUM(CASE type WHEN 'DEDUCT' THEN amount ELSE -amount END), 0) AS v FROM con_retention_ledger WHERE "organizationId" = $1`, [orgId])).rows[0].v);
  check('retention held by clients in the books = the retention ledger', close(await balance('RETENTION_RECEIVABLE'), heldSql) && heldSql > 0, { books: await balance('RETENTION_RECEIVABLE'), heldSql });
  const receipts = Number((await sql.query('SELECT count(*) FROM con_valuation_receipts WHERE "organizationId" = $1', [orgId])).rows[0].count);
  check('every IPC payment and withholding certificate is posted', (await postings('CON_IPC_RECEIPT')) === receipts && receipts > 0, { posted: await postings('CON_IPC_RECEIPT'), receipts });
  const whtSql = Number((await sql.query(`SELECT COALESCE(SUM(amount), 0) AS v FROM con_valuation_receipts WHERE "organizationId" = $1 AND kind IN ('WHT', 'WHT_VAT')`, [orgId])).rows[0].v);
  check('...withholding certificates are a credit with KRA', (await balance('WHT_RECEIVABLE')) >= whtSql - 0.01 && whtSql > 0);
  const paidRuns = Number((await sql.query(`SELECT count(*) FROM con_payroll_runs WHERE "organizationId" = $1 AND status = 'PAID'`, [orgId])).rows[0].count);
  check('every paid site pay run is posted', (await postings('CON_PAYROLL')) === paidRuns && paidRuns > 0, { posted: await postings('CON_PAYROLL'), paidRuns });
  const nssfSql = Number((await sql.query(`SELECT COALESCE(SUM(l.nssf), 0) AS v FROM con_payroll_lines l JOIN con_payroll_runs r ON r.id = l."runId" WHERE r."organizationId" = $1 AND r.status = 'PAID'`, [orgId])).rows[0].v);
  check('...the NSSF deducted is owed in the books', close(-(await balance('NSSF')), nssfSql) || -(await balance('NSSF')) >= nssfSql, { books: -(await balance('NSSF')), nssfSql });
  const subWork = Number((await sql.query(`SELECT COALESCE(SUM(v."grossToDate"), 0) AS v FROM con_subcontracts s JOIN LATERAL (SELECT "grossToDate" FROM con_sub_valuations x WHERE x."subcontractId" = s.id AND x.status IN ('APPROVED', 'PAID') ORDER BY x.number DESC LIMIT 1) v ON true WHERE s."organizationId" = $1`, [orgId])).rows[0].v);
  check('subcontractor costs = the work approved on every subcontract', close(await balance('SUBCONTRACTORS'), subWork) && subWork > 0, { books: await balance('SUBCONTRACTORS'), subWork });
  const paidSubs = Number((await sql.query(`SELECT count(*) FROM con_sub_valuations WHERE "organizationId" = $1 AND status = 'PAID'`, [orgId])).rows[0].count);
  check('...and each subcontractor payment is posted', (await postings('CON_SUB_PAID')) === paidSubs && paidSubs > 0, { posted: await postings('CON_SUB_PAID'), paidSubs });
  const zaroda = Number((await sql.query(`SELECT count(*) FROM con_subscription_payments WHERE "organizationId" = $1 AND status = 'PAID'`, [orgId])).rows[0].count);
  check('every payment to ZARODA (plan, slots, texts, fees) is a ZARODA cost', (await postings('ZARODA_CON_PAYMENT')) === zaroda && zaroda > 0, { posted: await postings('ZARODA_CON_PAYMENT'), zaroda });
  const tb = (await sql.query('SELECT SUM(debit) AS d, SUM(credit) AS c FROM journal_lines WHERE "organizationId" = $1', [orgId])).rows[0];
  check("Uriri's books still balance", close(tb.d, tb.c), tb);
  check('posting again changes nothing', await (async () => {
    const before = Number((await sql.query('SELECT count(*) FROM journal_entries WHERE "organizationId" = $1', [orgId])).rows[0].count);
    await dir.post('/accounting/post-now', {});
    return Number((await sql.query('SELECT count(*) FROM journal_entries WHERE "organizationId" = $1', [orgId])).rows[0].count) === before;
  })());

  section('13j. Enterprise: branch offices, custom roles, API keys (C8)');
  await sql.query('DELETE FROM con_api_keys WHERE "organizationId" = $1', [orgId]);
  await sql.query('DELETE FROM con_user_custom_roles WHERE "organizationId" = $1', [orgId]);
  await sql.query('DELETE FROM con_custom_roles WHERE "organizationId" = $1', [orgId]);
  await sql.query('UPDATE con_projects SET "officeId" = NULL WHERE "organizationId" = $1', [orgId]);
  await sql.query('DELETE FROM con_user_offices WHERE "organizationId" = $1', [orgId]);
  await sql.query('DELETE FROM con_offices WHERE "organizationId" = $1', [orgId]);
  check('offices need the Enterprise plan (upgrade prompt)', (await dir.get('/construction/offices')).status === 402);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_ENTERPRISE' WHERE "organizationId" = $1`, [orgId]);
  check('only the Director manages offices', (await acc.get('/construction/offices')).status === 403);
  const office = await dir.post('/construction/offices', { name: `Kisumu ${tag}`, county: 'Kisumu' });
  check('the Director adds a branch office', office.status === 201 && office.json.name === `Kisumu ${tag}`, office.json);
  check('...office names are unique', (await dir.post('/construction/offices', { name: `Kisumu ${tag}` })).status === 409);
  const allProjects = (await dir.get('/construction/projects')).json;
  const qsId = (await dir.get('/construction/staff')).json.find((s) => s.email === 'qs@uriri.demo').orgUserId;
  check('the QS sees every project before joining an office', (await qs.get('/construction/projects')).json.length === allProjects.length && allProjects.length >= 2);
  check('the QS is put in the Kisumu office', (await dir.put(`/construction/staff/${qsId}/office`, { officeId: office.json.id })).status === 200);
  check('...and now sees none (no projects in that office yet)', (await qs.get('/construction/projects')).json.length === 0);
  check('the demo project moves to the Kisumu office', (await dir.put(`/construction/projects/${sid}/office`, { officeId: office.json.id })).json.officeId === office.json.id);
  const qsSees = (await qs.get('/construction/projects')).json;
  check('...the QS sees only that project', qsSees.length === 1 && qsSees[0].id === sid && qsSees[0].officeId === office.json.id, qsSees.map((p) => p.code));
  const other = allProjects.find((p) => p.id !== sid);
  check("...and cannot open another office's project", [403, 404].includes((await qs.get(`/construction/projects/${other.id}`)).status));
  check('...but still works on their own (BQ opens)', (await qs.get(`/construction/projects/${sid}/bq`)).status === 200);
  check('an unknown office is refused', (await dir.put(`/construction/staff/${qsId}/office`, { officeId: randomUUIDish() })).status === 404);
  check('the Director always sees every project', (await dir.get('/construction/projects')).json.length === allProjects.length);
  const offices = (await dir.get('/construction/offices')).json;
  check('the office list counts its projects and staff', offices.find((o) => o.id === office.json.id)?.projects === 1 && offices.find((o) => o.id === office.json.id)?.staff === 1, offices);
  check('removing the office...', (await dir.del(`/construction/offices/${office.json.id}`)).status === 200);
  check('...puts its staff back at head office (all projects)', (await qs.get('/construction/projects')).json.length === allProjects.length);

  const storeId = (await dir.get('/construction/staff')).json.find((s) => s.email === 'store@uriri.demo').orgUserId;
  check('the storekeeper cannot see tenders', (await store.get('/construction/tenders')).status === 403);
  check('a custom role can never act as Director', (await dir.post('/construction/custom-roles', { name: 'Boss', grants: ['CON_DIRECTOR'] })).status === 400);
  const buyer = await dir.post('/construction/custom-roles', { name: `Site buyer ${tag}`, grants: ['CON_PROCUREMENT'], approvalLimit: 100000 });
  check('the Director makes a custom role "Site buyer" (procurement, approves up to KES 100,000)', buyer.status === 201 && buyer.json.grants[0] === 'CON_PROCUREMENT' && buyer.json.approvalLimit === 100000, buyer.json);
  check('only the Director makes roles', (await acc.post('/construction/custom-roles', { name: 'x', grants: ['CON_QS'] })).status === 403);
  check('the storekeeper is given it', (await dir.put(`/construction/staff/${storeId}/custom-roles`, { customRoleIds: [buyer.json.id] })).status === 200);
  check('...and can now see tenders, as procurement', (await store.get('/construction/tenders')).status === 200);
  check('...the staff list shows it', (await dir.get('/construction/staff')).json.find((s) => s.orgUserId === storeId).customRoleIds.includes(buyer.json.id));
  check('the role list shows who holds it', (await dir.get('/construction/custom-roles')).json.find((r) => r.id === buyer.json.id)?.holders === 1);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_PRO' WHERE "organizationId" = $1`, [orgId]);
  check('off the Enterprise plan the custom role stops working', (await store.get('/construction/tenders')).status === 403);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_ENTERPRISE' WHERE "organizationId" = $1`, [orgId]);
  check('taking the role away...', (await dir.put(`/construction/staff/${storeId}/custom-roles`, { customRoleIds: [] })).status === 200);
  check('...takes the access away', (await store.get('/construction/tenders')).status === 403);
  check('the role is deleted', (await dir.del(`/construction/custom-roles/${buyer.json.id}`)).status === 200);

  const key = await dir.post('/construction/api-keys', { name: `Power BI ${tag}`, scopes: ['projects'] });
  check('the Director creates a read-only API key (shown once)', key.status === 201 && /^zcon_[0-9a-f]{12}_/.test(key.json.key), key.json);
  const apiKeyRow = (await sql.query('SELECT "keyHash" FROM con_api_keys WHERE id = $1', [key.json.id])).rows[0];
  check('...only its hash is stored', apiKeyRow && !apiKeyRow.keyHash.includes(key.json.key.slice(18)) && apiKeyRow.keyHash.length === 64);
  check('...the key list never shows it again', !JSON.stringify((await dir.get('/construction/api-keys')).json).includes(key.json.key));
  const byKey = (p, k = key.json.key) => call('GET', `/construction-api/v1${p}`, { headers: { Authorization: `Bearer ${k}` } });
  const apiProjects = await byKey('/projects');
  check('the API lists the projects', apiProjects.status === 200 && apiProjects.json.length === allProjects.length, apiProjects.status);
  check('...and opens one', (await byKey(`/projects/${sid}`)).json.id === sid);
  check('...but not IPCs or reports (not in its scopes)', (await byKey(`/projects/${sid}/ipcs`)).status === 403 && (await byKey('/reports/ipc')).status === 403);
  check('the API cannot change anything', [404, 405].includes((await call('POST', '/construction-api/v1/projects', { headers: { Authorization: `Bearer ${key.json.key}` }, body: {} })).status));
  check('a wrong key is refused', (await byKey('/projects', key.json.key.slice(0, -4) + 'AAAA')).status === 401);
  check('no key is refused', (await call('GET', '/construction-api/v1/projects')).status === 401);
  check("another business's staff token is not a key", (await byKey('/projects', fresh._token)).status === 401);
  const usage = (await dir.get('/construction/api-keys')).json.find((k) => k.id === key.json.id);
  check('each call is counted on the key', usage.requests >= 2 && usage.lastUsedAt, usage);
  const full = await dir.post('/construction/api-keys', { name: `ERP ${tag}`, scopes: ['projects', 'ipcs', 'reports'] });
  const apiIpcs = await byKey(`/projects/${sid}/ipcs`, full.json.key);
  check('a key with IPCs reads only certified / paid IPCs', apiIpcs.status === 200 && apiIpcs.json.length >= 1 && apiIpcs.json.every((v) => ['CERTIFIED', 'PAID'].includes(v.status)), apiIpcs.json);
  check('...and runs a report as JSON', (await byKey('/reports/ipc', full.json.key)).status === 200);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_PRO' WHERE "organizationId" = $1`, [orgId]);
  check('off the Enterprise plan the key stops working', (await byKey('/projects', full.json.key)).status === 403);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_ENTERPRISE' WHERE "organizationId" = $1`, [orgId]);
  check('a revoked key...', (await dir.del(`/construction/api-keys/${key.json.id}`)).json.revokedAt);
  check('...is refused', (await byKey('/projects')).status === 401);
  const entAudit = (await sql.query(`SELECT action FROM audit_log WHERE "organizationId" = $1 AND "createdAt" >= $2::timestamp AND action ~ '^con_(office|user_office|project.office_set|custom_role|user_custom_roles|api_key)'`, [orgId, new Date(t0).toISOString().replace('T', ' ').replace('Z', '')])).rows.map((r) => r.action);
  check('audit: offices, custom roles and API keys are all logged', ['con_office.created', 'con_office.deleted', 'con_user_office.set', 'con_project.office_set', 'con_custom_role.created', 'con_user_custom_roles.set', 'con_api_key.created', 'con_api_key.revoked'].every((a) => entAudit.includes(a)), [...new Set(entAudit)]);
  await sql.query('DELETE FROM con_api_keys WHERE "organizationId" = $1', [orgId]);
  await sql.query(`UPDATE con_subscriptions SET "planCode" = 'CON_CONTRACTOR' WHERE "organizationId" = $1`, [orgId]);

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

  const team = (await sql.query(`INSERT INTO sales_teams (id, name, "updatedAt") VALUES (gen_random_uuid(), $1, now()) RETURNING id`, [`E2E team ${tag}`])).rows[0];
  const agent = (await sql.query(`INSERT INTO sales_agents (id, "teamId", role, "fullName", email, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), $1, 'MEMBER', 'Agent Wanjiku', $2, 'x', now()) RETURNING id`, [team.id, `agent-${tag}@test.local`])).rows[0];
  await sql.query('UPDATE organizations SET "salesTeamId" = $1, "salesAgentId" = $2 WHERE id = $3', [team.id, agent.id, signup.json.organizationId]);
  const billing = await admin.get('/platform-admin/construction/billing');
  const mine = billing.json.commissions?.find((c) => c.organizationId === signup.json.organizationId);
  check('billing report: MRR matches the tenants list and plans are counted by status', billing.status === 200 && billing.json.mrr === (await admin.get('/platform-admin/construction/tenants')).json.mrr && billing.json.perPlan.length === 5 && billing.json.perPlan.every((p) => ['active', 'trial', 'grace', 'suspended'].every((k) => typeof p[k] === 'number')), billing.json.perPlan);
  check('...the agent earns 15% of first-year payments, not payable until the second payment', mine && mine.agent === 'Agent Wanjiku' && mine.rate === 0.15 && mine.commission === 5250 && mine.payable === false, mine);
  await sql.query(`INSERT INTO con_subscription_payments (id, "organizationId", "planCode", cycle, months, amount, status, method, "paidAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'CON_FUNDI', 'MONTHLY', 1, 3500, 'PAID', 'BANK', now(), now())`, [signup.json.organizationId]);
  const billing2 = (await admin.get('/platform-admin/construction/billing')).json;
  const mine2 = billing2.commissions.find((c) => c.organizationId === signup.json.organizationId);
  check('...after the second payment it is payable: 15% of 38,500', mine2.payable === true && mine2.commission === 5775 && billing2.commissionDue >= 5775, mine2);
  await sql.query(`UPDATE con_subscriptions SET status = 'TRIAL', "currentPeriodEnd" = now() + interval '3 days' WHERE "organizationId" = $1`, [signup.json.organizationId]);
  check('...trials ending this week are listed', (await admin.get('/platform-admin/construction/billing')).json.trialsEnding.some((t) => t.id === signup.json.organizationId));
  await sql.query(`UPDATE con_subscriptions SET status = 'ACTIVE', "currentPeriodEnd" = now() - interval '30 days' WHERE "organizationId" = $1`, [signup.json.organizationId]);
  check('...and suspended tenants', (await admin.get('/platform-admin/construction/billing')).json.suspended.some((t) => t.id === signup.json.organizationId));
  check('the billing report is for ZARODA admins only', [401, 403].includes((await dir.get('/platform-admin/construction/billing')).status));
  await sql.query('UPDATE organizations SET "salesTeamId" = NULL, "salesAgentId" = NULL WHERE id = $1', [signup.json.organizationId]);
  await sql.query('DELETE FROM sales_teams WHERE id = $1', [team.id]);

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
