// End-to-end test of the school joining link against the LOCAL test setup: a school fills in a supplier's joining form,
// waits for approval, and joins a second supplier with the same email and phone. Refuses to run against the live database.
//
// Needs: the test Postgres (port 5433) migrated with rls applied, and the API started with `pnpm --filter api start:test`.
//   node scripts/e2e-school-join.js
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

const API = process.env.API || 'http://localhost:3001';
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}`, detail ? JSON.stringify(detail).slice(0, 400) : '');
  }
};
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, body } = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json };
}

async function supplier(tag, n) {
  const r = await api('POST', '/auth/register', {
    body: { organizationName: `Supplier ${n} ${tag}`, industryType: 'SCHOOL_SUPPLIER', ownerFullName: `Owner ${n}`, ownerEmail: `sup${n}-${tag}@test.local`, ownerPassword: 'password123', branchName: 'Main' },
  });
  if (r.status !== 201) throw new Error(`could not register supplier ${n}: ${JSON.stringify(r.json)}`);
  const token = r.json.accessToken;
  const slug = `join${n}-${tag}`;
  const p = await api('PUT', '/school-supplier/portal', { token, body: { slug, displayName: `Supplier ${n} ${tag}` } });
  check(`supplier ${n}'s link is saved with joining on by default`, p.status === 200 && p.json.joinEnabled === true, p);
  return { token, slug };
}

(async () => {
  const tag = Date.now().toString(36);
  const phone = `07${String(Date.now()).slice(-8)}`;
  const email = `Bursar-${tag}@School.ac.ke`;
  const form = { name: `Kisumu Girls ${tag}`, contactName: 'Bursar', phone, email, county: 'Kisumu', address: 'P.O. Box 1', notes: 'KRA P051234567X' };

  section('1. Two suppliers with joining links');
  const s1 = await supplier(tag, 1);
  const s2 = await supplier(tag, 2);
  const info = await api('GET', `/school-auth/portal/${s1.slug}`);
  check('the public portal info says joining is open', info.status === 200 && info.json.joinEnabled === true, info);

  section('2. A school asks to join supplier 1');
  check('a bad PIN is refused', (await api('POST', '/school-auth/join', { body: { slug: s1.slug, ...form, pin: '12' } })).status === 400);
  check('an email is required', (await api('POST', '/school-auth/join', { body: { slug: s1.slug, ...form, email: undefined, pin: '4821' } })).status === 400);
  check('an unknown link is refused', (await api('POST', '/school-auth/join', { body: { slug: 'no-such-link-xyz', ...form, pin: '4821' } })).status === 404);
  const j1 = await api('POST', '/school-auth/join', { body: { slug: s1.slug, ...form, pin: '4821' } });
  check('the join request is accepted and waits for approval', j1.status === 201 && j1.json.status === 'PENDING', j1);
  await sleep(61_000); // the join and sign-in routes allow 5 calls a minute
  const again = await api('POST', '/school-auth/join', { body: { slug: s1.slug, ...form, pin: '4821' } });
  check('asking again with the same phone is refused as already waiting', again.status === 409 && /already asked/.test(again.json?.message), again);

  const list1 = await api('GET', '/school-supplier/schools', { token: s1.token });
  const mine = list1.json.find((s) => s.phone.endsWith(phone.slice(1)));
  check('supplier 1 sees the school as PENDING with its details', mine && mine.status === 'PENDING' && mine.email === email.toLowerCase() && mine.county === 'Kisumu' && /KRA/.test(mine.notes), mine);
  const list2 = await api('GET', '/school-supplier/schools', { token: s2.token });
  check('supplier 2 does not see it', list2.status === 200 && !list2.json.some((s) => s.id === mine.id));

  const wrongPin = await api('POST', '/school-auth/login', { body: { slug: s1.slug, phone, pin: '0000' } });
  check('a waiting school with the wrong PIN gets the usual wrong-details answer', wrongPin.status === 401, wrongPin);
  const pending = await api('POST', '/school-auth/login', { body: { slug: s1.slug, phone, pin: '4821' } });
  check('a waiting school with its PIN is told it is not approved yet', pending.status === 403 && /not approved/.test(pending.json?.message), pending);

  section('3. The same school joins supplier 2 with the same email and phone');
  const j2 = await api('POST', '/school-auth/join', { body: { slug: s2.slug, ...form, pin: '7319' } });
  check('the same email and phone can join a second supplier', j2.status === 201, j2);
  const theirs = (await api('GET', '/school-supplier/schools', { token: s2.token })).json.find((s) => s.phone.endsWith(phone.slice(1)));
  check('supplier 2 has its own record for the school', theirs && theirs.id !== mine.id && theirs.status === 'PENDING' && theirs.email === email.toLowerCase(), theirs);

  section('4. Approving and turning down');
  const approve = await api('PATCH', `/school-supplier/schools/${mine.id}`, { token: s1.token, body: { status: 'ACTIVE', creditDays: 45, creditLimit: 200000 } });
  check('supplier 1 approves the school with its credit terms', approve.status === 200 && approve.json.status === 'ACTIVE' && approve.json.creditDays === 45, approve);
  check('an approved school cannot be "turned down"', (await api('DELETE', `/school-supplier/schools/${mine.id}/join-request`, { token: s1.token })).status === 400);
  const in1 = await api('POST', '/school-auth/login', { body: { slug: s1.slug, phone, pin: '4821' } });
  check('the approved school signs in to supplier 1 with the PIN it chose', in1.status === 200 && Boolean(in1.json.accessToken), in1);
  const out2 = await api('POST', '/school-auth/login', { body: { slug: s2.slug, phone, pin: '7319' } });
  check('it is still waiting at supplier 2', out2.status === 403, out2);
  const declined = await api('DELETE', `/school-supplier/schools/${theirs.id}/join-request`, { token: s2.token });
  check('supplier 2 turns the request down', declined.status === 200 && declined.json.declined === true, declined);
  check('the request is gone from supplier 2', !(await api('GET', '/school-supplier/schools', { token: s2.token })).json.some((s) => s.id === theirs.id));
  check("supplier 2 cannot turn down supplier 1's school", (await api('DELETE', `/school-supplier/schools/${mine.id}/join-request`, { token: s2.token })).status === 404);

  section('5. Switching the joining link off');
  const off = await api('PUT', '/school-supplier/portal', { token: s2.token, body: { slug: s2.slug, displayName: `Supplier 2 ${tag}`, joinEnabled: false } });
  check('supplier 2 switches joining off', off.status === 200 && off.json.joinEnabled === false && off.json.enabled === true, off);
  await sleep(61_000);
  const closed = await api('POST', '/school-auth/join', { body: { slug: s2.slug, ...form, phone: `07${String(Date.now()).slice(-8)}`, pin: '5555' } });
  check('the joining form is refused while it is off', closed.status === 404, closed);
  check('the portal info says joining is closed', (await api('GET', `/school-auth/portal/${s2.slug}`)).json?.joinEnabled === false);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
