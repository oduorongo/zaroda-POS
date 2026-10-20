// End-to-end test of rider sign-in by phone number + PIN against a LOCAL test setup: self sign-up, sign-in, wrong-PIN
// lockout, forgot-PIN by text code, a shop adding a rider without an email (and getting a one-time PIN), shop PIN reset.
// Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) and the API started with the test settings, with the demo seed.
//   node scripts/e2e-rider-pin.js        (takes about 3 minutes: sign-in is limited to 5 tries a minute per address)
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
const codeHash = (identifier, code) => createHash('sha256').update(`rider:${identifier}:${code}:${env.BUYER_JWT_SECRET}`).digest('hex');
const login = (p, pin) => api('POST', '/rider-auth/login', { body: { phone: p, pin } });

(async () => {
  await sql.connect();
  // Sign-in is limited per minute: when this is run straight after an earlier run, set WAIT_SECONDS=65 to let the allowance refill.
  if (process.env.WAIT_SECONDS) await sleep(Number(process.env.WAIT_SECONDS) * 1000);

  section('1. A rider signs up with just a name, phone number and PIN');
  check('API ready', (await api('GET', '/ready')).status === 200);
  const juma = phone();
  const signup = await api('POST', '/rider-auth/signup', { body: { fullName: 'Juma Otieno', phone: juma, pin: '4821' } });
  check('sign-up works and signs them straight in', signup.status === 201 && Boolean(signup.json.accessToken), signup);
  check('they start as PENDING with no email', signup.json.rider?.status === 'PENDING' && signup.json.rider?.email === null, signup.json.rider);
  check('the profile says a PIN is set', signup.json.rider?.hasPin === true);
  const stored = (await sql.query('SELECT "pinHash", phone FROM riders WHERE phone = $1', [norm(juma)])).rows[0];
  check('the PIN is stored hashed, never as typed', Boolean(stored?.pinHash) && !stored.pinHash.includes('4821'), stored);
  check('the number is stored in 2547... form', stored?.phone === norm(juma));
  const token = signup.json.accessToken;
  check('the new token opens their rider page', (await api('GET', '/rider/me', { token })).json.phone === norm(juma));
  const dup = await api('POST', '/rider-auth/signup', { body: { fullName: 'Someone Else', phone: juma, pin: '9999' } });
  check('the same number cannot sign up twice', dup.status === 409, dup);
  const shortPin = await api('POST', '/rider-auth/signup', { body: { fullName: 'Short Pin', phone: phone(), pin: '12' } });
  check('a 2-digit PIN is refused', shortPin.status === 400, shortPin);
  const letters = await api('POST', '/rider-auth/signup', { body: { fullName: 'Letter Pin', phone: phone(), pin: 'abcd' } });
  check('a PIN with letters is refused', letters.status === 400, letters);

  section('2. Signing in');
  const ok = await login(juma, '4821');
  check('the right PIN signs in', ok.status === 200 && Boolean(ok.json.accessToken), ok);
  const spaced = await login(`${juma.slice(0, 4)} ${juma.slice(4, 7)} ${juma.slice(7)}`, '4821');
  check('a number typed with spaces still works', spaced.status === 200, spaced);
  const wrong = await login(juma, '1111');
  check('a wrong PIN is refused', wrong.status === 401 && wrong.json.message === 'Wrong phone number or PIN', wrong);
  const unknown = await login(phone(), '4821');
  check('an unknown number gets the exact same answer (no way to find out who is registered)', unknown.status === 401 && unknown.json.message === wrong.json.message, unknown);
  const failCount = (await sql.query('SELECT "pinFailCount" FROM riders WHERE phone = $1', [norm(juma)])).rows[0].pinFailCount;
  check('one wrong try was counted', failCount === 1, failCount);
  const reset = await login(juma, '4821');
  check('a correct sign-in clears the count', reset.status === 200 && (await sql.query('SELECT "pinFailCount" FROM riders WHERE phone = $1', [norm(juma)])).rows[0].pinFailCount === 0);

  section('3. Five wrong PINs lock the account');
  console.log('  (waiting a minute: sign-in is limited to 5 tries a minute)');
  await sleep(62_000);
  for (let i = 0; i < 5; i++) await login(juma, '0000');
  // Stored as UTC; compare in the database so this computer's time zone cannot skew the check.
  const locked = (await sql.query(`SELECT "pinLockedUntil" > ((now() at time zone 'utc') + interval '10 minutes') AS ok FROM riders WHERE phone = $1`, [norm(juma)])).rows[0].ok;
  check('the account is locked for about 15 minutes', locked === true, locked);

  section('4. Forgot the PIN: a text code (the lock is lifted by choosing a new PIN)');
  const asked = await api('POST', '/rider-auth/pin-reset/request', { body: { phone: juma } });
  check('asking for a code works (texts are not set up locally, so it is only logged)', asked.status === 200 && asked.json.sent === true, asked);
  const unknownAsk = await api('POST', '/rider-auth/pin-reset/request', { body: { phone: phone() } });
  check('an unregistered number is told to ask their shop (and nothing is sent)', unknownAsk.json.sent === false && /shop or Zaroda/.test(unknownAsk.json.message), unknownAsk);
  // The real code only reaches the phone, so plant a code we know (the newest one wins).
  await sql.query('INSERT INTO rider_otps (id, email, "codeHash", "expiresAt", "createdAt") VALUES (gen_random_uuid(), $1, $2, now() + interval \'5 minutes\', now() + interval \'1 second\')', [norm(juma), codeHash(norm(juma), '246810')]);
  const badCode = await api('POST', '/rider-auth/pin-reset/verify', { body: { phone: juma, code: '000000', pin: '7766' } });
  check('a wrong code is refused', badCode.status === 401, badCode);
  const good = await api('POST', '/rider-auth/pin-reset/verify', { body: { phone: juma, code: '246810', pin: '7766' } });
  check('the right code sets the new PIN and signs them in', good.status === 200 && Boolean(good.json.accessToken), good);
  const after = (await sql.query('SELECT "pinFailCount", "pinLockedUntil" FROM riders WHERE phone = $1', [norm(juma)])).rows[0];
  check('the lock is cleared', after.pinFailCount === 0 && after.pinLockedUntil === null, after);
  const replay = await api('POST', '/rider-auth/pin-reset/verify', { body: { phone: juma, code: '246810', pin: '5555' } });
  check('the code cannot be used twice', replay.status === 401, replay);

  section('5. The new PIN works and the old one does not');
  console.log('  (waiting a minute for the sign-in allowance)');
  await sleep(62_000);
  check('new PIN signs in', (await login(juma, '7766')).status === 200);
  check('old PIN is refused', (await login(juma, '4821')).status === 401);

  section('6. A rider changes their own PIN once signed in');
  const changed = await api('PATCH', '/rider/me/pin', { token: good.json.accessToken, body: { pin: '3030' } });
  check('changing the PIN works', changed.status === 200 && changed.json.hasPin === true, changed);
  check('the changed PIN signs in', (await login(juma, '3030')).status === 200);
  const noPhone = await api('POST', '/rider-auth/verify', { body: { email: 'nobody@example.com', code: '123456' } });
  check('email codes still behave as before (a wrong code is refused)', noPhone.status === 401, noPhone);

  console.log('  (waiting a minute for the sign-in allowance)');
  await sleep(62000);
  section('7. A shop adds a rider with no email and gets a one-time PIN');
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const ben = phone();
  const added = await api('POST', '/riders', { token: owner, body: { fullName: 'Ben Ouma', phone: ben, vehicleType: 'BODA' } });
  check('the shop adds the rider without an email', added.status === 201 && added.json.email === null, added);
  check('they are approved at once', added.json.status === 'APPROVED');
  check('a PIN is shown once', /^\d{4}$/.test(added.json.temporaryPin || ''), added.json.temporaryPin);
  const listed = await api('GET', '/riders', { token: owner });
  check('the PIN is never shown again in the list', !JSON.stringify(listed.json).includes(added.json.temporaryPin) || listed.json.every((r) => !('temporaryPin' in r)), null);
  const benIn = await login(ben, added.json.temporaryPin);
  check('Ben signs in with his phone and that PIN', benIn.status === 200 && benIn.json.rider?.status === 'APPROVED', benIn);

  section('8. The shop resets a rider\'s PIN');
  const resetPin = await api('POST', `/riders/${added.json.id}/reset-pin`, { token: owner, body: {} });
  check('a new PIN comes back once', resetPin.status === 200 && /^\d{4}$/.test(resetPin.json.temporaryPin || '') && resetPin.json.temporaryPin !== added.json.temporaryPin, resetPin);
  check('the new PIN works', (await login(ben, resetPin.json.temporaryPin)).status === 200);
  check('the old PIN stops working', (await login(ben, added.json.temporaryPin)).status === 401);
  const other = await api('POST', `/riders/${signup.json.rider.id}/reset-pin`, { token: owner, body: {} });
  check('a shop cannot reset the PIN of a rider that is not theirs', other.status === 404, other);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
