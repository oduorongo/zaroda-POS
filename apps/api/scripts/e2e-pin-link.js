// End-to-end test that one phone number + PIN works as a rider AND as a shopper (the same person), against a LOCAL test
// setup. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) and the API started with the test settings.
//   node scripts/e2e-pin-link.js         (set WAIT_SECONDS=70 when running straight after another sign-in test)
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const phone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const norm = (p) => `254${p.replace(/^0/, '')}`;
const codeHash = (identifier, code) => createHash('sha256').update(`${identifier}:${code}:${env.BUYER_JWT_SECRET}`).digest('hex');
const shopperLogin = (p, pin) => api('POST', '/buyer-auth/login', { body: { phone: p, pin } });
const riderLogin = (p, pin) => api('POST', '/rider-auth/login', { body: { phone: p, pin } });

(async () => {
  await sql.connect();
  if (process.env.WAIT_SECONDS) await sleep(Number(process.env.WAIT_SECONDS) * 1000);
  check('API ready', (await api('GET', '/ready')).status === 200);

  section('1. A rider signs in at the shopper page with the same phone number and PIN');
  const juma = phone();
  await api('POST', '/rider-auth/signup', { body: { fullName: 'Juma Otieno', phone: juma, pin: '4821' } });
  check('no shopper account exists yet', (await sql.query('SELECT 1 FROM buyers WHERE phone = $1', [norm(juma)])).rowCount === 0);
  const asShopper = await shopperLogin(juma, '4821');
  check('the shopper page accepts the rider PIN', asShopper.status === 200 && Boolean(asShopper.json.accessToken), asShopper);
  check('a shopper account was opened with his name and phone', asShopper.json.buyer?.phone === norm(juma) && asShopper.json.buyer?.name === 'Juma Otieno' && asShopper.json.buyer?.hasPin === true, asShopper.json.buyer);
  check('the new shopper token works for orders', (await api('GET', '/buyer/orders', { token: asShopper.json.accessToken })).status === 200);
  check('signing in as a shopper again works as a normal shopper account', (await shopperLogin(juma, '4821')).status === 200);

  section('2. A shopper signs in at the rider page with the same phone number and PIN');
  const amina = phone();
  await api('POST', '/buyer-auth/signup', { body: { phone: amina, pin: '7766', name: 'Amina' } });
  const asRider = await riderLogin(amina, '7766');
  check('the rider page accepts the shopper PIN', asRider.status === 200 && Boolean(asRider.json.accessToken), asRider);
  check('a rider account was opened - waiting for approval, like any new rider', asRider.json.rider?.status === 'PENDING' && asRider.json.rider?.phone === norm(amina) && asRider.json.rider?.fullName === 'Amina', asRider.json.rider);

  section('3. Wrong PINs and unproven numbers are still refused');
  const rider2 = phone();
  await api('POST', '/rider-auth/signup', { body: { fullName: 'Only Rider', phone: rider2, pin: '2468' } });
  const wrong = await shopperLogin(rider2, '0000');
  check('a wrong PIN at the shopper page is refused', wrong.status === 401 && wrong.json.message === 'Wrong phone number or PIN', wrong);
  check('and it counts against the rider account', (await sql.query('SELECT "pinFailCount" FROM riders WHERE phone = $1', [norm(rider2)])).rows[0].pinFailCount === 1);
  check('no shopper account was opened for it', (await sql.query('SELECT 1 FROM buyers WHERE phone = $1', [norm(rider2)])).rowCount === 0);
  const remembered = phone();
  await sql.query(`INSERT INTO buyers (id, phone, "updatedAt") VALUES (gen_random_uuid(), $1, now())`, [norm(remembered)]);
  await api('POST', '/rider-auth/signup', { body: { fullName: 'Squatter', phone: remembered, pin: '1357' } });
  const takeover = await shopperLogin(remembered, '1357');
  check('a rider PIN does NOT open an existing shopper account (its owner never proved the number)', takeover.status === 401, takeover);

  section('4. A PIN reset by code (which proves the number) changes both logins');
  await sql.query(`INSERT INTO buyer_otps (id, channel, identifier, "codeHash", "expiresAt", "createdAt") VALUES (gen_random_uuid(), 'SMS', $1, $2, now() + interval '5 minutes', now() + interval '1 second')`, [norm(amina), codeHash(norm(amina), '246810')]);
  const reset = await api('POST', '/buyer-auth/pin-reset/verify', { body: { phone: amina, code: '246810', pin: '9090' } });
  check('the reset works', reset.status === 200, reset);
  console.log('  (waiting a minute for the sign-in allowance)');
  await sleep(62_000);
  check('the rider login now uses the new PIN', (await riderLogin(amina, '9090')).status === 200);
  check('and the old PIN no longer works there', (await riderLogin(amina, '7766')).status === 401);
  check('the shopper login uses the new PIN too', (await shopperLogin(amina, '9090')).status === 200);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
