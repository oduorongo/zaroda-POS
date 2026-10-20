// End-to-end test of shopper sign-in by phone number + PIN against a LOCAL test setup: sign-up, sign-in, wrong-PIN
// lockout, forgot-PIN by code, and an email shopper adding a phone and PIN. Never touches the live system (refuses
// unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) and the API started with the test settings.
//   node scripts/e2e-buyer-pin.js        (about 2 minutes: sign-in is limited to 5 tries a minute per address;
//                                         set WAIT_SECONDS=70 when running straight after another sign-in test)
const fs = require('fs');
const path = require('path');
const { createHash, createHmac, randomUUID } = require('crypto');

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
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// A shopper token for a shopper made straight in the database (as if they had signed in by email).
const tokenFor = (id) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: id, scope: 'buyer', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', env.BUYER_JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};
const login = (p, pin) => api('POST', '/buyer-auth/login', { body: { phone: p, pin } });

(async () => {
  await sql.connect();
  if (process.env.WAIT_SECONDS) await sleep(Number(process.env.WAIT_SECONDS) * 1000);

  section('1. A shopper creates an account with just a phone number and PIN');
  check('API ready', (await api('GET', '/ready')).status === 200);
  check('the sign-in screen is told PINs are available', (await api('GET', '/buyer-auth/methods')).json.pin === true);
  const amina = phone();
  const signup = await api('POST', '/buyer-auth/signup', { body: { phone: amina, pin: '4821', name: 'Amina' } });
  check('sign-up works and signs them straight in', signup.status === 201 && Boolean(signup.json.accessToken), signup);
  check('the account has the phone, name and a PIN, but no email', signup.json.buyer?.phone === norm(amina) && signup.json.buyer?.name === 'Amina' && signup.json.buyer?.hasPin === true && signup.json.buyer?.email === null, signup.json.buyer);
  const row = (await sql.query('SELECT "pinHash" FROM buyers WHERE phone = $1', [norm(amina)])).rows[0];
  check('the PIN is stored hashed, never as typed', Boolean(row?.pinHash) && !row.pinHash.includes('4821'));
  check('the new token works for the shopper pages', (await api('GET', '/buyer/orders', { token: signup.json.accessToken })).status === 200);
  check('the same number cannot sign up twice', (await api('POST', '/buyer-auth/signup', { body: { phone: amina, pin: '9999' } })).status === 409);
  check('a 2-digit PIN is refused', (await api('POST', '/buyer-auth/signup', { body: { phone: phone(), pin: '12' } })).status === 400);

  section('2. Signing in');
  const ok = await login(amina, '4821');
  check('the right PIN signs in', ok.status === 200 && Boolean(ok.json.accessToken), ok);
  const spaced = await login(`${amina.slice(0, 4)} ${amina.slice(4, 7)} ${amina.slice(7)}`, '4821');
  check('a number typed with spaces still works', spaced.status === 200, spaced);
  const wrong = await login(amina, '1111');
  check('a wrong PIN is refused', wrong.status === 401 && wrong.json.message === 'Wrong phone number or PIN', wrong);
  const unknown = await login(phone(), '4821');
  check('an unknown number gets the exact same answer', unknown.status === 401 && unknown.json.message === wrong.json.message, unknown);

  section('3. Five wrong PINs lock the account');
  console.log('  (waiting a minute: sign-in is limited to 5 tries a minute)');
  await sleep(62_000);
  for (let i = 0; i < 5; i++) await login(amina, '0000');
  const locked = (await sql.query(`SELECT "pinLockedUntil" > ((now() at time zone 'utc') + interval '10 minutes') AS ok FROM buyers WHERE phone = $1`, [norm(amina)])).rows[0].ok;
  check('the account is locked for about 15 minutes', locked === true, locked);

  section('4. Forgot the PIN: a code (and the lock is lifted by choosing a new PIN)');
  const asked = await api('POST', '/buyer-auth/pin-reset/request', { body: { phone: amina } });
  check('asking for a code works (texts are not set up locally, so it is only logged)', asked.status === 200 && asked.json.sent === true, asked);
  const unknownAsk = await api('POST', '/buyer-auth/pin-reset/request', { body: { phone: phone() } });
  check('an unregistered number is told to contact support', unknownAsk.json.sent === false && /WhatsApp/.test(unknownAsk.json.message), unknownAsk);
  await sql.query(`INSERT INTO buyer_otps (id, channel, identifier, "codeHash", "expiresAt", "createdAt") VALUES (gen_random_uuid(), 'SMS', $1, $2, now() + interval '5 minutes', now() + interval '1 second')`, [norm(amina), codeHash(norm(amina), '246810')]);
  check('a wrong code is refused', (await api('POST', '/buyer-auth/pin-reset/verify', { body: { phone: amina, code: '000000', pin: '7766' } })).status === 401);
  const good = await api('POST', '/buyer-auth/pin-reset/verify', { body: { phone: amina, code: '246810', pin: '7766' } });
  check('the right code sets the new PIN and signs them in', good.status === 200 && Boolean(good.json.accessToken), good);
  const after = (await sql.query('SELECT "pinFailCount", "pinLockedUntil" FROM buyers WHERE phone = $1', [norm(amina)])).rows[0];
  check('the lock is cleared', after.pinFailCount === 0 && after.pinLockedUntil === null, after);
  check('the code cannot be used twice', (await api('POST', '/buyer-auth/pin-reset/verify', { body: { phone: amina, code: '246810', pin: '5555' } })).status === 401);

  section('5. The new PIN works and the old one does not');
  console.log('  (waiting a minute for the sign-in allowance)');
  await sleep(62_000);
  check('new PIN signs in', (await login(amina, '7766')).status === 200);
  check('old PIN is refused', (await login(amina, '4821')).status === 401);

  section('6. A shopper who signed in by email adds a phone number and PIN');
  const id = randomUUID();
  await sql.query(`INSERT INTO buyers (id, email, "updatedAt") VALUES ($1, $2, now())`, [id, `emailshopper-${id.slice(0, 8)}@example.com`]);
  const emailToken = tokenFor(id);
  const me = await api('GET', '/buyer/me', { token: emailToken });
  check('the email shopper has no PIN yet', me.status === 200 && me.json.hasPin === false, me);
  check('a PIN without a phone number is refused (they have none yet)', (await api('PATCH', '/buyer/me/pin', { token: emailToken, body: { pin: '2468' } })).status === 400);
  check('they cannot take a number that already belongs to someone else', (await api('PATCH', '/buyer/me/pin', { token: emailToken, body: { pin: '2468', phone: amina } })).status === 409);
  const mine = phone();
  const added = await api('PATCH', '/buyer/me/pin', { token: emailToken, body: { pin: '2468', phone: mine } });
  check('with their own number the PIN is saved', added.status === 200 && added.json.hasPin === true && added.json.phone === norm(mine), added);
  check('and they can now sign in with it', (await login(mine, '2468')).status === 200);

  await sql.end();
  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
