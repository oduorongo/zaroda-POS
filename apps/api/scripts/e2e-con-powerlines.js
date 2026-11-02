// End-to-end test of power-line contractors (docs/construction/07) against a LOCAL test setup (Uriri Builders demo seed): EPRA licence
// classes and the voltage check on tenders, electricians' licences, sections and daily progress, wayleaves (with a file), crossings,
// as-built assets, client-supplied materials, who may do what, and the audit log.
// Needs the test Postgres (5433) with the latest migrations + apply-rls, the construction seed, and the API on the test settings.
//   node scripts/e2e-con-powerlines.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR] }));
const readEnv = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, '')]));
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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 500) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, p, token, body, headers = {}) {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(API + p, { method, headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const login = async (email) => (await call('POST', '/auth/login', undefined, { email, password: 'password123' })).json.accessToken;
const sql = new Client({ connectionString: env.DIRECT_URL });
const nairobi = (o = 0) => new Date(Date.now() + 3 * 3600_000 + o * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36).toUpperCase();
const LINE_TABLES = ['con_section_progress', 'con_project_sections', 'con_wayleaves', 'con_crossings', 'con_line_assets', 'con_client_material_moves', 'con_client_items'];

(async () => {
  await sql.connect();
  const director = await login('director@uriri.demo');
  const comp = await login('compliance@uriri.demo');
  const pm = await login('pm@uriri.demo');
  const site = await login('site@uriri.demo');
  const store = await login('store@uriri.demo');
  check('five staff sign in', [director, comp, pm, site, store].every(Boolean));
  const as = (t) => ({ get: (p) => call('GET', `/construction${p}`, t), post: (p, b) => call('POST', `/construction${p}`, t, b), put: (p, b) => call('PUT', `/construction${p}`, t, b), del: (p) => call('DELETE', `/construction${p}`, t) });
  const D = as(director), C = as(comp), P = as(pm), S = as(site), T = as(store);
  const org = (await call('GET', '/organizations/me', director)).json;
  const listed = (await P.get('/projects')).json;
  const project = (listed.rows ?? listed).find((p) => p.code === 'PRJ-001');
  const pid = project.id;
  for (const t of LINE_TABLES) await sql.query(`DELETE FROM ${t} WHERE "projectId" = $1`, [pid]);
  await sql.query(`DELETE FROM con_compliance_docs WHERE "organizationId" = $1 AND type = 'EPRA_LICENCE'`, [org.id]);
  await sql.query(`UPDATE con_epra_classes SET "anyVoltage" = (code = 'A1'), "maxVoltageKv" = NULL WHERE "organizationId" = $1`, [org.id]);

  section('1. EPRA licences and the voltage check');
  const classes = await C.get('/compliance/epra-classes');
  check('five EPRA classes; A1 covers any voltage, the others are unset until confirmed with EPRA', classes.status === 200 && classes.json.length === 5 && classes.json.find((c) => c.code === 'A1').anyVoltage && classes.json.filter((c) => c.maxVoltageKv === null && !c.anyVoltage).length === 4, classes.json);
  await C.put('/compliance/registrations', { worksClass: 'ELEC_MECH', ncaCategory: 1, regNo: `E-${tag}` });
  const tender = { title: `11kV line ${tag}`, procuringEntity: 'REREC', worksClass: 'ELEC_MECH', voltageKv: 11, estValue: 2500000 };
  const noLicence = await C.post('/tenders', tender);
  check('an 11 kV line tender without an EPRA licence is stopped, saying why', noLicence.status === 400 && noLicence.json.epraFailed === true && /EPRA/.test(noLicence.json.message), noLicence.json);
  check('an EPRA licence needs its class', (await C.post('/compliance/docs', { type: 'EPRA_LICENCE', title: 'EPRA licence', expiresAt: nairobi(300) })).status === 400);
  const lic = await C.post('/compliance/docs', { type: 'EPRA_LICENCE', title: 'EPRA licence', refNo: `EPRA-${tag}`, epraClass: 'B', expiresAt: nairobi(300) });
  check('Compliance records a class B EPRA licence', lic.status === 201 && lic.json.epraClass === 'B', lic.json);
  const bUnset = await C.post('/tenders', tender);
  check('class B with no voltage set does not cover the line', bUnset.status === 400 && /class B/.test(bUnset.json.message), bUnset.json);
  check('a class needs a voltage or "any voltage"', (await C.put('/compliance/epra-classes/B', { anyVoltage: false })).status === 400);
  check('the project manager cannot change EPRA classes', (await P.put('/compliance/epra-classes/B', { anyVoltage: false, maxVoltageKv: 11 })).status === 403);
  const setB = await C.put('/compliance/epra-classes/B', { anyVoltage: false, maxVoltageKv: 11 });
  check('Compliance sets class B to 11 kV', setB.status === 200 && setB.json.maxVoltageKv === 11, setB.json);
  const okTender = await C.post('/tenders', tender);
  check('now the 11 kV tender goes in, with its voltage', okTender.status === 201 && okTender.json.voltageKv === 11, okTender.json);
  const t33 = { ...tender, title: `33kV line ${tag}`, voltageKv: 33 };
  check('a 33 kV line is still beyond class B', (await C.post('/tenders', t33)).status === 400);
  const over = await D.post('/tenders', { ...t33, overrideReason: 'Joint venture with an A1 contractor' });
  check('the Director may go ahead anyway, and the reason is kept', over.status === 201 && over.json.capOverrideReason === 'Joint venture with an A1 contractor', over.json);

  section("2. Electricians' licences");
  const people = (await D.get('/people')).json;
  const fred = people.find((p) => p.fullName === 'Fredrick Ouma');
  check('the project manager cannot record a licence', (await P.post('/staff-licences', { orgUserId: fred.orgUserId, licenceClass: 'A1 electrician', licenceNo: 'X', expiresAt: nairobi(200) })).status === 403);
  const sl = await C.post('/staff-licences', { orgUserId: fred.orgUserId, licenceClass: 'Electrician A1', licenceNo: `EL-${tag}`, expiresAt: nairobi(20) });
  check("Compliance records an electrician's EPRA licence", sl.status === 201, sl.json);
  const list = (await D.get('/staff-licences')).json.find((l) => l.id === sl.json.id);
  check('it lists with the holder, and shows it expires within 60 days', list && list.name === 'Fredrick Ouma' && list.body === 'EPRA' && list.state === 'EXPIRING', list);

  section('3. Sections and daily progress');
  check('the storekeeper cannot add a section', (await T.post(`/projects/${pid}/sections`, { code: 'S1', name: 'x' })).status === 403);
  check('a section cannot end before it starts', (await P.post(`/projects/${pid}/sections`, { code: 'S1', name: 'Km 5 to 0', fromKm: 5, toKm: 0 })).status === 400);
  const s1 = await P.post(`/projects/${pid}/sections`, { code: 's1', name: 'Km 0 to 5', fromKm: 0, toKm: 5, targetPoles: 40, targetConductorKm: 2, targetTransformers: 2 });
  check('the project manager adds section S1 with its targets', s1.status === 201, s1.json);
  check('section codes are unique on a project', (await P.post(`/projects/${pid}/sections`, { code: 'S1', name: 'Again' })).status === 409);
  const p1 = await S.put(`/projects/${pid}/sections/${s1.json.id}/progress/${nairobi()}`, { poles: 10, conductorKm: 0.5, crew: 'Crew A' });
  check("the site supervisor records today's progress", p1.status === 200, p1.json);
  const p2 = await S.put(`/projects/${pid}/sections/${s1.json.id}/progress/${nairobi()}`, { poles: 12, conductorKm: 0.5, crew: 'Crew A' });
  check('saving the same day again replaces it (one entry per section per day)', p2.status === 200 && p2.json.id === p1.json.id, p2.json);
  await S.put(`/projects/${pid}/sections/${s1.json.id}/progress/${nairobi(-1)}`, { poles: 8, conductorKm: 0.5, transformers: 1 });
  check('progress cannot be recorded for tomorrow', (await S.put(`/projects/${pid}/sections/${s1.json.id}/progress/${nairobi(1)}`, { poles: 1 })).status === 400);
  const ov1 = (await P.get(`/projects/${pid}/power-line`)).json;
  const os1 = ov1.sections.find((s) => s.code === 'S1');
  check('S1: 20 of 40 poles (50%), 1 of 2 km, 1 of 2 transformers: 50% overall', os1 && os1.measures.find((m) => m.measure === 'poles').done === 20 && os1.measures.find((m) => m.measure === 'conductorKm').done === 1 && os1.percent === 50, os1);

  section('4. Wayleaves and crossings');
  check('a site supervisor cannot record a wayleave', (await S.post(`/projects/${pid}/wayleaves`, { landowner: 'x y' })).status === 403);
  check('an agreed wayleave needs the date it was agreed', (await P.post(`/projects/${pid}/wayleaves`, { landowner: 'Mary Atieno', status: 'AGREED' })).status === 400);
  const w = await P.post(`/projects/${pid}/wayleaves`, { landowner: 'Mary Atieno', phone: '0711000111', parcelNo: 'KISII/1234', chainageKm: 1.2, sectionId: s1.json.id, status: 'AGREED', compensation: 15000, agreedAt: nairobi(-3) });
  check('the project manager records an agreed wayleave with compensation', w.status === 201, w.json);
  await P.post(`/projects/${pid}/wayleaves`, { landowner: 'John Okello', chainageKm: 2.4 });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000000000020001e221bc330000000049454e44ae426082', 'hex');
  const up = await call('POST', `/construction/projects/${pid}/wayleaves/${w.json.id}/file`, pm, png, { 'Content-Type': 'image/png', 'x-file-name': 'consent.png' });
  check('the signed consent is uploaded', up.status === 201 || up.status === 200, up.json);
  const file = await fetch(`${API}/construction/projects/${pid}/wayleaves/${w.json.id}/file`, { headers: { Authorization: `Bearer ${site}` } });
  check('and the site supervisor can open it', file.status === 200 && (file.headers.get('content-type') ?? '').startsWith('image/png'));
  const cr = await P.post(`/projects/${pid}/crossings`, { kind: 'ROAD', authority: 'KeNHA', refNo: `KENHA-${tag}`, status: 'APPROVED', approvedAt: nairobi(-10), expiresAt: nairobi(25) });
  check('a KeNHA road crossing approval is recorded with its expiry', cr.status === 201, cr.json);
  const ov2 = (await D.get(`/projects/${pid}/power-line`)).json;
  check('the overview counts wayleaves (1 agreed, 1 pending) and the compensation', ov2.wayleaves.counts.agreed === 1 && ov2.wayleaves.counts.pending === 1 && ov2.wayleaves.compensation === 15000 && ov2.wayleaves.rows.find((r) => r.id === w.json.id)?.hasFile === true, ov2.wayleaves);
  check('the crossing shows as expiring within 60 days', ov2.crossings[0]?.state === 'EXPIRING', ov2.crossings);

  section('5. As-built assets');
  check('a position needs both latitude and longitude', (await S.post(`/projects/${pid}/line-assets`, { kind: 'POLE', tag: 'P-001', lat: -0.68 })).status === 400);
  const a1 = await S.post(`/projects/${pid}/line-assets`, { kind: 'POLE', tag: 'p-001', spec: '11m wooden pole', lat: -0.681234, lng: 34.771234, sectionId: s1.json.id, installedAt: nairobi() });
  check('the site supervisor records pole P-001 with its GPS position', a1.status === 201, a1.json);
  check('the same pole number cannot be recorded twice', (await S.post(`/projects/${pid}/line-assets`, { kind: 'POLE', tag: 'P-001' })).status === 409);
  const a2 = await S.post(`/projects/${pid}/line-assets`, { kind: 'TRANSFORMER', tag: 'TX-01', serialNo: `SN${tag}`, spec: '100 kVA 11/0.415 kV' });
  check('a transformer with its serial number', a2.status === 201);
  check('a pole entered by mistake can be removed', (await S.del(`/projects/${pid}/line-assets/${a2.json.id}`)).status === 200);
  const assets = (await P.get(`/projects/${pid}/power-line`)).json.assets;
  check('the register has the pole with its section and position', assets.length === 1 && assets[0].tag === 'P-001' && assets[0].section === 'S1' && assets[0].lat === -0.681234, assets);

  section('6. Client-supplied materials');
  const item = await T.post(`/projects/${pid}/client-materials/items`, { code: 'pole-11m', description: '11m treated wooden pole', unit: 'no' });
  check('the storekeeper adds a free-issue item', item.status === 201, item.json);
  const rec = await T.post(`/projects/${pid}/client-materials/moves`, { itemId: item.json.id, kind: 'RECEIVED', quantity: 50, reference: `KPLC-DN-${tag}` });
  check('50 poles received from the client against their delivery note', rec.status === 201, rec.json);
  const tooMany = await T.post(`/projects/${pid}/client-materials/moves`, { itemId: item.json.id, kind: 'ISSUED', quantity: 60 });
  check('issuing more than is on hand is refused', tooMany.status === 400 && /Only 50 on hand/.test(tooMany.json.message), tooMany.json);
  check('only an issue goes to a section', (await T.post(`/projects/${pid}/client-materials/moves`, { itemId: item.json.id, kind: 'RETURNED', quantity: 1, sectionId: s1.json.id })).status === 400);
  check('20 issued to section S1', (await T.post(`/projects/${pid}/client-materials/moves`, { itemId: item.json.id, kind: 'ISSUED', quantity: 20, sectionId: s1.json.id })).status === 201);
  await T.post(`/projects/${pid}/client-materials/moves`, { itemId: item.json.id, kind: 'RETURNED', quantity: 5, reference: 'RN-1' });
  await T.post(`/projects/${pid}/client-materials/moves`, { itemId: item.json.id, kind: 'DAMAGED', quantity: 1, note: 'Cracked in transit' });
  const cm = (await T.get(`/projects/${pid}/client-materials`)).json;
  const bal = cm.items.find((i) => i.code === 'POLE-11M');
  check('reconciliation: 50 received, 20 issued, 5 returned, 1 damaged, 24 on hand', bal && bal.received === 50 && bal.issued === 20 && bal.returned === 5 && bal.damaged === 1 && bal.onHand === 24, bal);
  check('removing the receipt would leave more out than in, so it is refused', (await T.del(`/projects/${pid}/client-materials/moves/${rec.json.id}`)).status === 400);
  check('the storekeeper cannot open the power-line overview (money and land)', (await T.get(`/projects/${pid}/power-line`)).status === 403);

  section('7. Audit and isolation');
  const audited = (await sql.query(`SELECT action, count(*)::int n FROM audit_log WHERE "organizationId" = $1 AND action LIKE ANY(ARRAY['con_section%','con_progress%','con_wayleave%','con_crossing%','con_line_asset%','con_client_%','con_staff_licence%','con_epra_class%']) GROUP BY action`, [org.id])).rows;
  check('every kind of change is in the audit log', ['con_section.created', 'con_progress.created', 'con_progress.updated', 'con_wayleave.created', 'con_wayleave.file_uploaded', 'con_crossing.created', 'con_line_asset.created', 'con_line_asset.deleted', 'con_client_item.created', 'con_client_move.created', 'con_staff_licence.created', 'con_epra_class.updated'].every((a) => audited.some((r) => r.action === a)), audited);
  for (const t of ['con_epra_classes', 'con_staff_licences', ...LINE_TABLES]) {
    const r = (await sql.query('SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1', [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }

  for (const t of LINE_TABLES) await sql.query(`DELETE FROM ${t} WHERE "projectId" = $1`, [pid]);
  await sql.query(`DELETE FROM con_tenders WHERE "organizationId" = $1 AND title LIKE $2`, [org.id, `%${tag}`]);
  await sql.query(`DELETE FROM con_staff_licences WHERE "licenceNo" = $1`, [`EL-${tag}`]);
  await sql.query(`DELETE FROM con_compliance_docs WHERE "refNo" = $1`, [`EPRA-${tag}`]);
  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
