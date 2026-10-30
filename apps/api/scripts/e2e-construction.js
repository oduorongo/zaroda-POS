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
const t0 = Date.now();

async function main() {
  await sql.connect();
  const org = (await sql.query(`SELECT id FROM organizations WHERE name = 'Uriri Builders Ltd' AND "industryType" = 'CONSTRUCTION'`)).rows[0];
  if (!org) throw new Error('Run prisma/seed-construction.ts first');
  const orgId = org.id;
  await sql.query('DELETE FROM con_alerts WHERE "organizationId" = $1', [orgId]);
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
  check('it has 6 permits, 3 consultants and 2 team members', detail.permits?.length === 6 && detail.parties.length === 3 && detail.members.length === 2, { p: detail.permits?.length, parties: detail.parties?.length, m: detail.members?.length });
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
