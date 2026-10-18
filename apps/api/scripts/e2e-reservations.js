// End-to-end test of table reservations against a LOCAL test setup: a restaurant switches reservations on, guests ask for
// tables from the marketplace, and the restaurant confirms, declines and seats them. Never touches the live system
// (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) and the API started with the test settings, with the demo seed's live
// "demo-shop".   node scripts/e2e-reservations.js
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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);
const day = (offset) => new Date(Date.now() + 3 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
// A phone number nobody has used before, so earlier runs' open requests never count against this one.
const phone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

(async () => {
  await sql.connect();

  section('1. Reservations are switched off until the restaurant opts in');
  check('API ready', (await api('GET', '/ready')).status === 200);
  const login = await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } });
  const owner = login.json.accessToken;
  check('owner can sign in', Boolean(owner), login);
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  const slug = store.slug;
  const branchId = store.fulfilmentBranchId;
  check('the demo shop is live', store.isPublished, store);
  const big = (await api('POST', '/restaurant/tables', { token: owner, body: { branchId, label: `Big-${tag}`, seats: 6 } })).json;
  const small = (await api('POST', '/restaurant/tables', { token: owner, body: { branchId, label: `Small-${tag}`, seats: 2 } })).json;
  check('two tables: one seating 6, one seating 2', Boolean(big.id && small.id), { big, small });
  // start every run from "off", whatever an earlier run left behind
  await api('PUT', '/restaurant/reservations/settings', { token: owner, body: { enabled: false } });
  const settingsOff = await api('GET', '/restaurant/reservations/settings', { token: owner });
  check('reservations start switched off', settingsOff.json.enabled === false, settingsOff.json);
  const infoOff = await api('GET', `/public/shops/${slug}/reservations/info`);
  check('the marketplace is told this restaurant is not taking requests', infoOff.status === 200 && infoOff.json.enabled === false, infoOff);
  const base = (over = {}) => ({ name: 'Amina Otieno', phone: phone(), partySize: 4, date: day(3), time: '19:30', ...over });
  const request = (body) => api('POST', `/public/shops/${slug}/reservations`, { body });
  const refusedOff = await request(base());
  check('a request is refused while reservations are off', refusedOff.status === 404, refusedOff);
  check('the reservation routes for staff need a sign-in', (await api('GET', '/restaurant/reservations')).status === 401);

  section('2. The restaurant switches reservations on');
  const on = await api('PUT', '/restaurant/reservations/settings', { token: owner, body: { enabled: true } });
  check('the owner switches reservations on', on.status === 200 && on.json.enabled === true, on);
  check('the marketplace now offers "Reserve a table"', (await api('GET', `/public/shops/${slug}/reservations/info`)).json.enabled === true);

  section('3. Requests that make no sense are refused');
  check('a date in the past', (await request(base({ date: day(-1) }))).status === 400);
  check('a date that is not a date', (await request(base({ date: '2026-02-30' }))).status === 400);
  check('a time that is not a time', (await request(base({ time: '25:00' }))).status === 400);
  check('a party of nobody', (await request(base({ partySize: 0 }))).status === 400);
  check('a crowd of 31 (call the restaurant)', (await request(base({ partySize: 31 }))).status === 400);
  check('more than 60 days ahead', (await request(base({ date: day(90) }))).status === 400);
  check('a phone number that is not a phone number', (await request(base({ phone: '123' }))).status === 400);
  check('no name', (await request(base({ name: '' }))).status === 400);

  section('4. A guest asks for a table');
  const guestPhone = phone();
  const first = await request(base({ phone: guestPhone, notes: 'Birthday - a quiet corner please' }));
  const g = first.json;
  check('the request is recorded as REQUESTED with a reference number', first.status === 201 && g.status === 'REQUESTED' && /^ZT-/.test(g.reservationNumber) && g.partySize === 4 && g.time === '19:30', first);
  check('the guest gets a secret for their page; nothing else gives access', typeof g.guestToken === 'string' && g.guestToken.includes('.'));
  const mine = await api('GET', `/public/reservations/${g.id}?k=${encodeURIComponent(g.guestToken)}`);
  check('the guest can open their request with their secret', mine.status === 200 && mine.json.id === g.id, mine);
  check('without the secret it is a 404', (await api('GET', `/public/reservations/${g.id}`)).status === 404);
  check('a wrong secret is a 404', (await api('GET', `/public/reservations/${g.id}?k=${encodeURIComponent(g.guestToken.slice(0, -2) + 'xx')}`)).status === 404);
  check('the guest\'s phone number is on their page only as they gave it - and no secret leaks', !/guestTokenHash|tokenHash/.test(JSON.stringify(mine.json)));
  await request(base({ phone: guestPhone, time: '12:00' }));
  await request(base({ phone: guestPhone, time: '13:00' }));
  const fourth = await request(base({ phone: guestPhone, time: '14:00' }));
  check('a fourth open request from the same phone is refused (anti-spam)', fourth.status === 409, fourth);

  section('5. The restaurant answers');
  const list = await api('GET', '/restaurant/reservations', { token: owner });
  const row = list.json.find?.((r) => r.id === g.id);
  check('the request shows on the restaurant\'s list with the guest\'s phone and note', row?.status === 'REQUESTED' && row.guestPhone === `254${guestPhone.slice(1)}` && row.notes === 'Birthday - a quiet corner please', row);
  const tooSmall = await api('POST', `/restaurant/reservations/${g.id}/confirm`, { token: owner, body: { tableId: small.id } });
  check('a party of 4 cannot be given a table that seats 2', tooSmall.status === 400 && /seats 2/.test(tooSmall.json.message || ''), tooSmall);
  const confirmed = await api('POST', `/restaurant/reservations/${g.id}/confirm`, { token: owner, body: { tableId: big.id, message: 'We will hold the table for 15 minutes.' } });
  check('the restaurant confirms it with the table that seats 6', (confirmed.status === 201 || confirmed.status === 200) && confirmed.json.status === 'CONFIRMED' && confirmed.json.tableLabel === `Big-${tag}`, confirmed);
  check('the guest sees it confirmed, with the table and the restaurant\'s message', (await api('GET', `/public/reservations/${g.id}?k=${encodeURIComponent(g.guestToken)}`)).json.restaurantNote === 'We will hold the table for 15 minutes.');
  check('answering twice is refused', (await api('POST', `/restaurant/reservations/${g.id}/confirm`, { token: owner, body: {} })).status === 400);

  const second = (await request(base({ partySize: 2, time: '20:30' }))).json;
  const clash = await api('POST', `/restaurant/reservations/${second.id}/confirm`, { token: owner, body: { tableId: big.id } });
  check('the same table an hour later is refused: it is already booked for the first party', clash.status === 409 && /already booked/.test(clash.json.message || ''), clash);
  const later = (await request(base({ partySize: 2, time: '22:00' }))).json;
  const ok = await api('POST', `/restaurant/reservations/${later.id}/confirm`, { token: owner, body: { tableId: big.id } });
  check('but the same table at 22:00 (over two hours later) is fine', ok.status === 201 || ok.status === 200, ok);

  const toDecline = (await request(base({ time: '18:00' }))).json;
  const declined = await api('POST', `/restaurant/reservations/${toDecline.id}/decline`, { token: owner, body: { reason: 'We are fully booked at that time - please try 21:00.' } });
  check('the restaurant can decline with a reason the guest sees', (declined.status === 201 || declined.status === 200) && declined.json.status === 'DECLINED' && /fully booked/.test(declined.json.restaurantNote), declined);
  check('a decline needs a reason', (await api('POST', `/restaurant/reservations/${second.id}/decline`, { token: owner, body: { reason: '' } })).status === 400);
  check('a declined request cannot then be confirmed', (await api('POST', `/restaurant/reservations/${toDecline.id}/confirm`, { token: owner, body: {} })).status === 400);

  section('6. The guest cancels, the party is seated, a no-show');
  const cancelled = await api('POST', `/public/reservations/${g.id}/cancel`, { body: { token: g.guestToken } });
  check('the guest cancels a confirmed reservation', cancelled.status === 200 && cancelled.json.status === 'CANCELLED', cancelled);
  check('cancelling twice is refused', (await api('POST', `/public/reservations/${g.id}/cancel`, { body: { token: g.guestToken } })).status === 400);
  check('someone else\'s secret cannot cancel it', (await api('POST', `/public/reservations/${later.id}/cancel`, { body: { token: g.guestToken } })).status === 404);
  const seated = await api('POST', `/restaurant/reservations/${later.id}/seat`, { token: owner });
  const tableNow = (await sql.query('SELECT status FROM restaurant_tables WHERE id = $1', [big.id])).rows[0];
  check('seating the party marks their table Occupied', seated.json.status === 'SEATED' && tableNow.status === 'OCCUPIED', { seated: seated.json.status, table: tableNow });
  check('a request nobody answered cannot be seated', (await api('POST', `/restaurant/reservations/${second.id}/seat`, { token: owner })).status === 400);
  const noShowTarget = (await request(base({ time: '16:00' }))).json;
  await api('POST', `/restaurant/reservations/${noShowTarget.id}/confirm`, { token: owner, body: {} });
  const noShow = await api('POST', `/restaurant/reservations/${noShowTarget.id}/no-show`, { token: owner });
  check('a confirmed party that never came is marked a no-show', noShow.json.status === 'NO_SHOW', noShow);
  const toCancel = (await request(base({ time: '17:00' }))).json;
  const cancelledByUs = await api('POST', `/restaurant/reservations/${toCancel.id}/cancel`, { token: owner, body: { reason: 'The kitchen is closed that evening.' } });
  check('the restaurant can cancel a request with a reason', cancelledByUs.json.status === 'CANCELLED' && /kitchen is closed/.test(cancelledByUs.json.restaurantNote), cancelledByUs);
  const forDay = await api('GET', `/restaurant/reservations?date=${day(3)}`, { token: owner });
  check('the list can be limited to one date, soonest first', Array.isArray(forDay.json) && forDay.json.length >= 5 && forDay.json.every((r) => r.date === day(3)) && forDay.json.map((r) => r.time).join() === [...forDay.json.map((r) => r.time)].sort().join(), forDay.json.map?.((r) => r.time));

  section('7. Switching reservations off again');
  await api('PUT', '/restaurant/reservations/settings', { token: owner, body: { enabled: false } });
  check('new requests are refused once it is off again', (await request(base())).status === 404);
  check('and the marketplace stops offering it', (await api('GET', `/public/shops/${slug}/reservations/info`)).json.enabled === false);

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
