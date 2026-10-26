// End-to-end test of tender adverts against a LOCAL test setup: a school registers, waits for approval, posts an advert, and
// a supplier sees it (with new / saved / dismissed), and the platform owner can suspend a school or take an advert down.
// Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and `ENV_FILE=.env.local node scripts/apply-rls.js`
// applied, the API started with the test settings, plus the demo seed and the test platform admin.
//   node scripts/e2e-tender-adverts.js
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
async function call(method, url, { token, body } = {}) {
  const send = () => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // a connection the server closed after refusing an oversized upload may be reused once: try again
  const response = await send().catch(() => send());
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36).toUpperCase();
const nairobi = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const phone = '0733' + String(Math.floor(100000 + Math.random() * 899999));
const phone2 = '0744' + String(Math.floor(100000 + Math.random() * 899999));

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const admin = (await api('POST', '/platform-admin/auth/login', { body: { email: 'admin@test.local', password: 'test-admin-password' } })).json.accessToken;
  check('the supplier and the platform owner can sign in', Boolean(owner) && Boolean(admin));

  section('1. A school registers and signs in');
  const reg = { name: `Lakeview Primary ${tag}`, contactName: 'Mrs Atieno', phone, email: `school${tag.toLowerCase()}@test.local`, county: 'Kisumu', pin: '4826' };
  check('a PIN that is too easy is refused', (await api('POST', '/tender-buyer-auth/register', { body: { ...reg, pin: '1234' } })).status === 400);
  check('a PIN of the wrong shape is refused', (await api('POST', '/tender-buyer-auth/register', { body: { ...reg, pin: 'abc' } })).status === 400);
  check('a bad phone number is refused', (await api('POST', '/tender-buyer-auth/register', { body: { ...reg, phone: '12345' } })).status === 400);
  const r1 = await api('POST', '/tender-buyer-auth/register', { body: reg });
  check('the school registers and starts as pending', r1.status === 201 && r1.json.school.status === 'PENDING' && Boolean(r1.json.accessToken), r1.json);
  check('the same number cannot register twice', (await api('POST', '/tender-buyer-auth/register', { body: reg })).status === 409);
  const wrong = await api('POST', '/tender-buyer-auth/login', { body: { phone, pin: '9999' } });
  check('a wrong PIN is refused', wrong.status === 401, wrong.json);
  const login = await api('POST', '/tender-buyer-auth/login', { body: { phone: '+254 ' + phone.slice(1), pin: '4826' } });
  const school = login.json.accessToken;
  check('the right PIN (number typed another way) signs in', login.status === 200 && Boolean(school), login.json);
  check('an unknown number gets the same answer as a wrong PIN', (await api('POST', '/tender-buyer-auth/login', { body: { phone: '0700000000', pin: '4826' } })).status === 401);
  check('a school token does not work as staff, and a staff token does not work for a school', (await api('GET', '/school-supplier/tender-adverts', { token: school })).status === 401 && (await api('GET', '/tender-buyer/me', { token: owner })).status === 401);
  check('a school can see its own account', (await api('GET', '/tender-buyer/me', { token: school })).json.name === reg.name);

  section('2. It cannot post until it is approved');
  const advert = { reference: `T/${tag}`, title: `Supply of stationery ${tag}`, description: 'Term 1 stationery for all classes, delivered to the school.', county: 'Kisumu', items: [{ description: 'Exercise books 96 pages', quantity: 500, unit: 'pcs' }, { description: 'Blue pens', quantity: 200, unit: 'boxes' }, { description: '   ' }], documentsInfo: 'Collect from the school office', closingDate: nairobi(14), contactName: 'Mrs Atieno', contactPhone: phone };
  const early = await api('POST', '/tender-buyer/adverts', { token: school, body: advert });
  check('a school waiting for approval is told so', early.status === 403 && /waiting to be approved/.test(early.json.message), early.json);
  check('and the supplier sees nothing of it', !JSON.stringify((await api('GET', `/school-supplier/tender-adverts?q=${tag}`, { token: owner })).json).includes(tag));

  section('3. The platform owner approves it');
  const list = (await api('GET', '/platform-admin/tender-schools', { token: admin })).json;
  const mine = list.find((b) => b.phone === '254' + phone.slice(1));
  check('the school is on the platform owner\'s list, waiting', mine && mine.status === 'PENDING', mine);
  check('a supplier cannot approve schools', (await api('POST', `/platform-admin/tender-schools/${mine.id}/status`, { token: owner, body: { status: 'APPROVED' } })).status === 401);
  const ok = await api('POST', `/platform-admin/tender-schools/${mine.id}/status`, { token: admin, body: { status: 'APPROVED' } });
  check('the platform owner approves it', ok.status === 201 && ok.json.status === 'APPROVED', ok.json);

  section('4. The school posts an advert');
  check('a closing date in the past is refused', (await api('POST', '/tender-buyer/adverts', { token: school, body: { ...advert, closingDate: nairobi(-1) } })).status === 400);
  check('a closing date today is refused', (await api('POST', '/tender-buyer/adverts', { token: school, body: { ...advert, closingDate: nairobi(0) } })).status === 400);
  check('a closing date more than 180 days away is refused', (await api('POST', '/tender-buyer/adverts', { token: school, body: { ...advert, closingDate: nairobi(200) } })).status === 400);
  check('a bad contact number is refused', (await api('POST', '/tender-buyer/adverts', { token: school, body: { ...advert, contactPhone: '123' } })).status === 400);
  const posted = await api('POST', '/tender-buyer/adverts', { token: school, body: advert });
  check('the advert is posted, with empty items dropped', posted.status === 201 && posted.json.status === 'OPEN' && posted.json.items.length === 2 && posted.json.closingDate === nairobi(14) && posted.json.contactPhone === '254' + phone.slice(1), posted.json);
  check('the school lists its adverts', (await api('GET', '/tender-buyer/adverts', { token: school })).json.some((a) => a.id === posted.json.id));
  const sendPdf = async (id, contentType, body, token = school) => {
    try {
      const r = await fetch(`${API}/tender-buyer/adverts/${id}/pdf?name=${encodeURIComponent('Tender Notice.pdf')}`, { method: 'POST', headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` }, body });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    } catch {
      // the server stops reading a body that is too big and closes the connection
      return { status: 0, json: {} };
    }
  };
  check('a file that is not sent as a PDF is refused', (await sendPdf(posted.json.id, 'text/plain', 'hello')).status === 400);
  check('a file called PDF that is not one is refused', (await sendPdf(posted.json.id, 'application/pdf', 'this is just some text, not a pdf')).status === 400);
  check('an empty file is refused', (await sendPdf(posted.json.id, 'application/pdf', '')).status === 400);
  check('a PDF over 10MB is refused', [0, 400, 413].includes((await sendPdf(posted.json.id, 'application/pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024)]))).status));
  const goodPdf = await sendPdf(posted.json.id, 'application/pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'));
  // a real upload needs the live file store (Vercel Blob); on this computer it answers 502/503 AFTER the file passed every check above
  check('a real PDF is attached (or, with no working file store on this computer, a storage error after the checks passed)', (goodPdf.status === 201 && Boolean(goodPdf.json.pdfUrl) && goodPdf.json.pdfName === 'Tender Notice.pdf') || [502, 503].includes(goodPdf.status), goodPdf);

  section('5. The supplier sees it');
  const sb = (qs = '') => api('GET', `/school-supplier/tender-adverts${qs}`, { token: owner });
  const before = (await api('GET', '/school-supplier/tender-adverts/new-count', { token: owner })).json.new;
  const s1 = (await sb(`?q=${tag}`)).json;
  const ad = s1.rows.find((r) => r.id === posted.json.id);
  check('the advert is on the supplier\'s list, new, with the school, closing date and contact', ad && ad.state === 'NEW' && ad.school.name === reg.name && ad.daysLeft === 14 && ad.contactPhone === '254' + phone.slice(1) && ad.items.length === 2 && ad.documentsInfo === 'Collect from the school office', ad);
  check('it is counted as new', before >= 1 && s1.counts.new >= 1);
  check('a search for a word in the items finds it, and a word that is not there does not', (await sb(`?q=exercise ${tag}`)).json.rows.length === 1 && (await sb(`?q=laptops ${tag}`)).json.rows.length === 0);
  check('the county filter works', (await sb(`?county=kisumu&q=${tag}`)).json.rows.length === 1 && (await sb(`?county=nairobi&q=${tag}`)).json.rows.length === 0);
  const seen = await api('PUT', `/school-supplier/tender-adverts/${posted.json.id}/state`, { token: owner, body: { state: 'SEEN' } });
  check('marking it seen takes it off the new count', seen.status === 200 && (await api('GET', '/school-supplier/tender-adverts/new-count', { token: owner })).json.new === before - 1);
  await api('PUT', `/school-supplier/tender-adverts/${posted.json.id}/state`, { token: owner, body: { state: 'SAVED' } });
  check('it can be saved for later', (await sb(`?show=SAVED&q=${tag}`)).json.rows.length === 1);
  await api('PUT', `/school-supplier/tender-adverts/${posted.json.id}/state`, { token: owner, body: { state: 'DISMISSED' } });
  check('a dismissed one drops out of the list, but can be found under dismissed', (await sb(`?q=${tag}`)).json.rows.length === 0 && (await sb(`?show=DISMISSED&q=${tag}`)).json.rows.length === 1);
  check('a made-up state is refused', (await api('PUT', `/school-supplier/tender-adverts/${posted.json.id}/state`, { token: owner, body: { state: 'BANANA' } })).status === 400);
  const notice = (await sql.query(`SELECT count(*)::int AS n FROM school_tender_notices WHERE "advertId" = $1`, [posted.json.id])).rows[0].n;
  check('what a supplier did is kept once, as its own row', notice === 1, notice);

  section('6. Changing and withdrawing an advert');
  const chg = await api('PUT', `/tender-buyer/adverts/${posted.json.id}`, { token: school, body: { ...advert, title: `Supply of stationery (revised) ${tag}`, closingDate: nairobi(21) } });
  check('the school can change an open advert', chg.status === 200 && /revised/.test(chg.json.title) && chg.json.closingDate === nairobi(21), chg.json);
  console.log('  (waiting a minute so the sign-in limit resets)');
  await new Promise((r) => setTimeout(r, 61_000));
  const other = await api('POST', '/tender-buyer-auth/register', { body: { ...reg, name: `Other School ${tag}`, phone: phone2, email: undefined, pin: '7391' } });
  const oPut = await api('PUT', `/tender-buyer/adverts/${posted.json.id}`, { token: other.json.accessToken, body: advert });
  const oCancel = await api('POST', `/tender-buyer/adverts/${posted.json.id}/cancel`, { token: other.json.accessToken });
  check('another school cannot change or withdraw it', oPut.status === 404 && oCancel.status === 404, [other.status, oPut.status, oPut.json, oCancel.status]);
  const cancelled = await api('POST', `/tender-buyer/adverts/${posted.json.id}/cancel`, { token: school });
  check('the school withdraws it, and it leaves the supplier\'s board', cancelled.status === 200 && cancelled.json.status === 'CANCELLED' && (await sb(`?show=DISMISSED&q=${tag}`)).json.rows.length === 0);
  check('a withdrawn advert cannot be changed or withdrawn again', (await api('PUT', `/tender-buyer/adverts/${posted.json.id}`, { token: school, body: advert })).status === 409 && (await api('POST', `/tender-buyer/adverts/${posted.json.id}/cancel`, { token: school })).status === 409);

  section('7. The platform owner can take an advert down, and suspend a school');
  const p2 = await api('POST', '/tender-buyer/adverts', { token: school, body: { ...advert, title: `Furniture for the new classroom ${tag}`, items: [{ description: 'Desks', quantity: 40, unit: 'pcs' }] } });
  check('a second advert is posted', p2.status === 201, p2.json);
  check('the platform owner sees every advert', (await api('GET', '/platform-admin/tender-adverts', { token: admin })).json.some((a) => a.id === p2.json.id));
  check('taking down needs a reason', (await api('POST', `/platform-admin/tender-adverts/${p2.json.id}/remove`, { token: admin, body: {} })).status === 400);
  check('the platform owner takes it down', (await api('POST', `/platform-admin/tender-adverts/${p2.json.id}/remove`, { token: admin, body: { reason: 'Not a real tender' } })).json.status === 'REMOVED' && (await sb(`?q=${tag} furniture`)).json.rows.length === 0);
  check('the school sees why', (await api('GET', '/tender-buyer/adverts', { token: school })).json.find((a) => a.id === p2.json.id).removedReason === 'Not a real tender');
  check('it can be put back', (await api('POST', `/platform-admin/tender-adverts/${p2.json.id}/restore`, { token: admin })).json.status === 'OPEN' && (await sb(`?q=${tag} furniture`)).json.rows.length === 1);
  const susp = await api('POST', `/platform-admin/tender-schools/${mine.id}/status`, { token: admin, body: { status: 'SUSPENDED', note: 'Misuse' } });
  check('suspending a school pulls its open adverts off the board', susp.status === 201 && (await sb(`?q=${tag} furniture`)).json.rows.length === 0);
  check('a suspended school cannot post', (await api('POST', '/tender-buyer/adverts', { token: school, body: advert })).status === 403);

  section('8. Daily limit and separation');
  await api('POST', `/platform-admin/tender-schools/${mine.id}/status`, { token: admin, body: { status: 'APPROVED' } });
  let last;
  for (let i = 0; i < 6; i++) last = await api('POST', '/tender-buyer/adverts', { token: school, body: { ...advert, title: `Another notice number ${i} ${tag}` } });
  check('a school can only post a handful of adverts a day', last.status === 409, last.json);
  for (const t of ['school_tender_notices']) {
    const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
  }

  section('9. A school posts from its supplier\'s ordering portal');
  const pslug = `e2e-tn-${tag.toLowerCase()}`;
  await api('PUT', '/school-supplier/portal', { token: owner, body: { slug: pslug, displayName: `Tender Test Stationers ${tag}` } });
  const phone3 = '0755' + String(Math.floor(100000 + Math.random() * 899999));
  const ps = await api('POST', '/school-supplier/schools', { token: owner, body: { name: `Portal School ${tag}`, contactName: 'Mr Otieno', phone: phone3 } });
  check('the supplier adds a school (as a customer)', ps.status === 201, ps.json);
  await api('PATCH', `/school-supplier/schools/${ps.json.id}`, { token: owner, body: { phone: phone3 } });
  const plog = await api('POST', '/school-auth/login', { body: { slug: pslug, phone: phone3, pin: ps.json.temporaryPin } });
  const ptoken = plog.json.accessToken;
  check('the school signs in to the supplier\'s ordering portal', plog.status === 200 && Boolean(ptoken), plog.json);
  const T = (m, p, o = {}) => api(m, `/school-portal/tender${p}`, { token: ptoken, ...o });
  check('before it has set anything up it has no tender account', (await T('GET', '/account')).json?.id === undefined);
  check('and cannot list or post adverts yet', (await T('GET', '/adverts')).status === 404 && (await T('POST', '/adverts', { body: advert })).status === 404);
  const acc = await T('POST', '/account');
  check('opening the tab makes its tender account from what the supplier holds, waiting for approval', acc.status === 200 && acc.json.status === 'PENDING' && acc.json.name === `Portal School ${tag}` && acc.json.phone === '254' + phone3.slice(1), acc.json);
  check('doing it again gives the same account', (await T('POST', '/account')).json.id === acc.json.id);
  const early2 = await T('POST', '/adverts', { body: { ...advert, title: `Portal tender ${tag}` } });
  check('until approved it cannot post, and is told so', early2.status === 403 && /waiting to be approved/.test(early2.json.message), early2.json);
  const pl = (await api('GET', '/platform-admin/tender-schools', { token: admin })).json.find((b) => b.id === acc.json.id);
  check('the platform owner sees it, marked as coming through a supplier', pl && pl.viaSupplier === true && pl.status === 'PENDING', pl);
  await api('POST', `/platform-admin/tender-schools/${acc.json.id}/status`, { token: admin, body: { status: 'APPROVED' } });
  const pa = await T('POST', '/adverts', { body: { ...advert, title: `Portal tender ${tag}`, items: [{ description: 'Chalk boxes', quantity: 30, unit: 'boxes' }] } });
  check('once approved the school posts an advert from the portal', pa.status === 201 && pa.json.status === 'OPEN', pa.json);
  check('and sees it in its list', (await T('GET', '/adverts')).json.some((a) => a.id === pa.json.id));
  const board = (await api('GET', `/school-supplier/tender-adverts?q=portal tender ${tag}`, { token: owner })).json.rows;
  check('suppliers see it on the board, from this school', board.length === 1 && board[0].school.name === `Portal School ${tag}`, board);
  check('the school can change and withdraw it from the portal', (await T('PUT', `/adverts/${pa.json.id}`, { body: { ...advert, title: `Portal tender (changed) ${tag}` } })).status === 200 && (await T('POST', `/adverts/${pa.json.id}/cancel`)).json.status === 'CANCELLED');
  check('the account made for it cannot be used to sign in on the tender page', (await api('POST', '/tender-buyer-auth/login', { body: { phone: phone3, pin: ps.json.temporaryPin } })).status === 401);
  check('a tender token does not work in the portal, and a portal token does not work on the tender page', (await api('GET', '/school-portal/tender/adverts', { token: school })).status === 401 && (await api('GET', '/tender-buyer/me', { token: ptoken })).status === 401);
  const clash = await api('POST', '/school-supplier/schools', { token: owner, body: { name: `Clash School ${tag}`, phone } });
  const clashLog = await api('POST', '/school-auth/login', { body: { slug: pslug, phone, pin: clash.json.temporaryPin } });
  const clashAcc = await api('POST', '/school-portal/tender/account', { token: clashLog.json.accessToken });
  check('a school whose number already has a tender account is told to sign in there', clashAcc.status === 409 && /tenders/.test(clashAcc.json.message), clashAcc.json);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
