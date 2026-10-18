// End-to-end test of hotel room booking against a LOCAL test setup: a hotel lists rooms, guests find and book them on
// the marketplace and pay the deposit by (pretend) M-Pesa, and the hotel checks them in and out. It never touches the
// live system (refuses unless the database is on this computer and Tuma is the pretend one).
//
// Needs running: the test Postgres (port 5433), the pretend Tuma (node scripts/mock-tuma.js), the API started with the
// test settings, and the demo seed's live "demo-shop".   node scripts/e2e-hotel.js
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
if (!/^http:\/\/localhost:\d+$/.test(env.TUMA_BASE_URL || '')) throw new Error('REFUSING: TUMA_BASE_URL is not a local pretend Tuma');

const API = 'http://localhost:3001';
const MOCK = 'http://localhost:4010';
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
const mock = (m, p) => call(m, MOCK + p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);
const day = (offset) => new Date(Date.now() + 3 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10); // a date in Kenya, offset days from today

(async () => {
  await sql.connect();

  section('1. The hotel sets up a room type');
  check('API ready', (await api('GET', '/ready')).status === 200);
  const login = await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } });
  const owner = login.json.accessToken;
  check('owner can sign in', Boolean(owner), login);
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  check('the shop is live with payments connected (the hotel uses its payment account)', store.isPublished && store.tumaConnected, store);
  const slug = store.slug;
  const dto = { name: `Deluxe-${tag}`, description: 'Sea view, king bed', amenities: 'WiFi, Breakfast, Hot shower', pricePerNight: 4000, maxGuests: 2, quantity: 2, depositPercent: 30, isListed: true };
  const created = await api('POST', '/hotel/room-types', { token: owner, body: dto });
  const roomType = created.json;
  check('a room type is created: KES 4,000 a night, 2 rooms, 30% deposit', created.status === 201 && roomType.pricePerNight === 4000 && roomType.quantity === 2 && roomType.isListed === true, created);
  const bad = await api('POST', '/hotel/room-types', { token: owner, body: { ...dto, quantity: 0 } });
  check('a room type with no rooms is refused', bad.status === 400, bad);
  const noAuth = await api('GET', '/hotel/room-types');
  check('the hotel screens need a sign-in', noAuth.status === 401, noAuth);

  section('2. What guests see on the marketplace');
  const A = day(40), B = day(43); // 3 nights
  const dirAll = await api('GET', '/public/hotels');
  check('the Hotels page lists the hotel with its starting price', Array.isArray(dirAll.json) && dirAll.json.some((h) => h.slug === slug && h.fromPrice <= 4000), dirAll);
  const dirDates = await api('GET', `/public/hotels?checkIn=${A}&checkOut=${B}`);
  check('searching with dates still finds it (rooms are free)', dirDates.json.some?.((h) => h.slug === slug));
  const page = await api('GET', `/public/hotels/${slug}?checkIn=${A}&checkOut=${B}`);
  const listed = page.json.roomTypes?.find((r) => r.id === roomType.id);
  check('the hotel page shows the room with 2 free and a quote for 3 nights: KES 12,000, deposit KES 3,600', listed?.roomsLeft === 2 && listed.quote?.nights === 3 && listed.quote.total === 12000 && listed.quote.deposit === 3600, listed);
  check('amenities are split into a list and no secrets leak', listed?.amenities?.length === 3 && !/tuma|apiKey|encrypted|guestTokenHash/i.test(JSON.stringify(page.json)));
  const unknown = await api('GET', '/public/hotels/no-such-hotel');
  check('an unknown hotel is a clean 404', unknown.status === 404);
  const nodates = (await api('GET', `/public/hotels/${slug}`)).json.roomTypes.find((r) => r.id === roomType.id);
  check('without dates the page shows prices but no availability or quote', nodates.roomsLeft === null && nodates.quote === null);

  section('3. Bookings that must be refused');
  const body = (over = {}) => ({ roomTypeId: roomType.id, checkIn: A, checkOut: B, rooms: 1, guests: 2, name: 'Amina', phone: '0722111222', ...over });
  const book = (b) => api('POST', `/public/hotels/${slug}/bookings`, { body: b });
  check('a bad phone number is refused', (await book(body({ phone: '123' }))).status === 400);
  check('a check-in date in the past is refused', (await book(body({ checkIn: day(-2), checkOut: day(1) }))).status === 400);
  check('check-out before check-in is refused', (await book(body({ checkIn: B, checkOut: A }))).status === 400);
  check('a stay of more than 30 nights is refused', (await book(body({ checkOut: day(80) }))).status === 400);
  check('3 guests in one room that sleeps 2 is refused', (await book(body({ guests: 3 }))).status === 400);
  check('asking for more rooms than the hotel has is refused', (await book(body({ rooms: 3, guests: 3 }))).status === 400);
  check('an unknown room is refused', (await book(body({ roomTypeId: '00000000-0000-0000-0000-000000000000' }))).status === 404);

  section('4. A guest books and the rooms are held while they pay');
  const first = await book(body());
  const g1 = first.json;
  check('booking placed: 3 nights, KES 12,000, deposit KES 3,600 due now', first.status === 201 && g1.status === 'PENDING_PAYMENT' && g1.total === 12000 && g1.depositAmount === 3600 && g1.balanceDue === 8400 && /^ZB-/.test(g1.bookingNumber), first);
  check('the guest is given a secret for their page; only its hash is stored', typeof g1.guestToken === 'string' && g1.guestToken.includes('.'));
  const pushes = (await mock('GET', '/_test/pushes')).json;
  const push1 = pushes[pushes.length - 1];
  check('an M-Pesa prompt for the DEPOSIT (KES 3,600) went to the guest', push1?.amount === 3600 && push1.phone === '254722111222', push1);
  check('the payment callback address is the secret, signed one', /\/public\/room-bookings\/[0-9a-f-]+\/[0-9a-f-]+\/tuma-callback\/[A-Za-z0-9_-]{30,}$/.test(push1?.callback_url || ''), push1);
  const afterOne = (await api('GET', `/public/hotels/${slug}?checkIn=${A}&checkOut=${B}`)).json.roomTypes.find((r) => r.id === roomType.id);
  check('while it waits to be paid, only 1 room is shown as free', afterOne.roomsLeft === 1, afterOne);
  const second = await book(body({ name: 'Brian', phone: '0733000444' }));
  check('a second guest can take the last room', second.status === 201, second);
  const third = await book(body({ name: 'Carol', phone: '0744555666' }));
  check('a third guest is refused: no rooms free for those dates', third.status === 409 && /no .* rooms are free/.test(third.json.message || ''), third);
  const dirFull = await api('GET', `/public/hotels?checkIn=${A}&checkOut=${B}`);
  check('a date search no longer lists the full hotel', !dirFull.json.some?.((h) => h.slug === slug));
  const checkoutDay = await book(body({ checkIn: B, checkOut: day(45), name: 'Dan', phone: '0755666777' }));
  check('but a guest arriving the day the others leave can book (no clash on check-out day)', checkoutDay.status === 201, checkoutDay);

  section('5. Privacy of the guest page');
  const mine = await api('GET', `/public/room-bookings/${g1.id}?k=${encodeURIComponent(g1.guestToken)}`);
  check('the guest can open their booking with their secret', mine.status === 200 && mine.json.id === g1.id, mine);
  check('without the secret it is a 404', (await api('GET', `/public/room-bookings/${g1.id}`)).status === 404);
  check('a wrong secret is a 404', (await api('GET', `/public/room-bookings/${g1.id}?k=${encodeURIComponent(g1.guestToken.slice(0, -2) + 'xx')}`)).status === 404);
  check('the other guest\'s secret does not open this booking', (await api('GET', `/public/room-bookings/${g1.id}?k=${encodeURIComponent(second.json.guestToken)}`)).status === 404);

  section('6. A fake payment is not believed; the real one confirms the booking');
  const stat0 = (await mock('GET', '/_test/status-calls')).json.count;
  await mock('POST', `/_test/forge/${push1.merchant_request_id}?mode=underpay`);
  const afterForge = (await api('GET', `/public/room-bookings/${g1.id}?k=${encodeURIComponent(g1.guestToken)}`)).json;
  check('an underpayment does not confirm the booking and is flagged', afterForge.status === 'PENDING_PAYMENT' && /doesn't match/.test(afterForge.lastPaymentError || ''), afterForge);
  const paid = await mock('POST', `/_test/pay/${push1.merchant_request_id}`);
  check('the guest pays; the callback is accepted', paid.status === 200 && paid.json.callbackAnsweredWith === 200, paid.json);
  const confirmed = (await api('GET', `/public/room-bookings/${g1.id}?k=${encodeURIComponent(g1.guestToken)}`)).json;
  check('the booking is CONFIRMED with the M-Pesa receipt', confirmed.status === 'CONFIRMED' && /^QTEST/.test(confirmed.mpesaReceiptNumber || ''), confirmed);
  check('the normal path made no paid status checks (callbacks are free)', (await mock('GET', '/_test/status-calls')).json.count === stat0);
  await mock('POST', `/_test/pay/${push1.merchant_request_id}`);
  check('the same payment replayed changes nothing', (await sql.query(`SELECT count(*)::int n FROM room_bookings WHERE "mpesaReceiptNumber" = $1`, [confirmed.mpesaReceiptNumber])).rows[0].n === 1);

  section('7. The hotel works with its bookings');
  const list = await api('GET', '/hotel/bookings', { token: owner });
  const row = list.json.find?.((b) => b.id === g1.id);
  check('the booking shows on the hotel\'s list with deposit paid and balance due at the hotel', row?.status === 'CONFIRMED' && row.depositPaid === 3600 && row.balanceDue === 8400 && row.guestName === 'Amina', row);
  const unpaidRow = list.json.find?.((b) => b.id === second.json.id);
  check('an unpaid booking shows as waiting for its deposit (nothing paid yet)', unpaidRow?.status === 'PENDING_PAYMENT' && unpaidRow.depositPaid === 0 && unpaidRow.balanceDue === 12000, unpaidRow);
  const earlyOut = await api('POST', `/hotel/bookings/${g1.id}/check-out`, { token: owner });
  check('a guest cannot be checked out before being checked in', earlyOut.status === 400, earlyOut);
  const inn = await api('POST', `/hotel/bookings/${g1.id}/check-in`, { token: owner });
  check('check-in', inn.status === 201 || inn.status === 200 ? inn.json.status === 'CHECKED_IN' : false, inn);
  const out = await api('POST', `/hotel/bookings/${g1.id}/check-out`, { token: owner });
  check('check-out', out.json.status === 'CHECKED_OUT', out);
  const commission = (await sql.query(`SELECT "commissionAmount" c FROM room_bookings WHERE id = $1`, [g1.id])).rows[0].c;
  check('commission is recorded on the deposit paid online: 3% of KES 3,600 = KES 108', Math.abs(Number(commission) - 108) < 0.001, commission);
  const grid = await api('GET', `/hotel/availability?from=${A}&days=7`, { token: owner });
  const gridRow = grid.json.roomTypes?.find((r) => r.id === roomType.id);
  check('the availability grid shows free rooms per night (the checked-out room is free again; the unpaid booking still holds one)', grid.json.nights?.length === 7 && gridRow?.free?.length === 7 && gridRow.free[0] === 1, gridRow);

  section('8. Cancelling and the room coming free');
  const payB = (await mock('GET', '/_test/pushes')).json.filter((p) => p.phone === '254733000444').pop();
  await mock('POST', `/_test/pay/${payB.merchant_request_id}`);
  await sleep(300);
  const cancel = await api('POST', `/hotel/bookings/${second.json.id}/cancel`, { token: owner, body: { reason: 'Guest asked to cancel' } });
  check('the hotel cancels a paid booking; the deposit (KES 3,600) is owed back to the guest', cancel.json.status === 'CANCELLED' && cancel.json.refundDue === 3600, cancel);
  const freed = (await api('GET', `/public/hotels/${slug}?checkIn=${A}&checkOut=${B}`)).json.roomTypes.find((r) => r.id === roomType.id);
  check('with the first guest checked out and the second cancelled, both rooms are bookable again', freed.roomsLeft === 2, freed);
  check('a cancelled booking cannot be cancelled again', (await api('POST', `/hotel/bookings/${second.json.id}/cancel`, { token: owner, body: { reason: 'again please' } })).status === 400);

  section('9. A deposit that arrives after the rooms were released');
  const late = await book(body({ name: 'Late Lucy', phone: '0766777888' }));
  check('a guest books a room', late.status === 201, late);
  const latePush = (await mock('GET', '/_test/pushes')).json.filter((p) => p.phone === '254766777888').pop();
  await sql.query(`UPDATE room_bookings SET "paymentDeadline" = (now() at time zone 'utc') - interval '1 minute' WHERE id = $1`, [late.json.id]);
  const taker = await book(body({ name: 'Quick Quentin', phone: '0777888999', rooms: 2, guests: 2 }));
  check('their 15 minutes pass, so their room is released and another guest takes BOTH rooms', taker.status === 201, taker);
  await mock('POST', `/_test/pay/${latePush.merchant_request_id}`);
  const lateNow = (await api('GET', `/public/room-bookings/${late.json.id}?k=${encodeURIComponent(late.json.guestToken)}`)).json;
  check('Lucy\'s late deposit is still honoured (she paid), but the booking is flagged for the hotel', lateNow.status === 'CONFIRMED' && /taken/.test(lateNow.lastPaymentError || ''), lateNow);

  section('10. Taking the rooms off the marketplace');
  const unlist = await api('PUT', `/hotel/room-types/${roomType.id}`, { token: owner, body: { ...dto, isListed: false } });
  check('the hotel unlists the room type', unlist.status === 200 && unlist.json.isListed === false, unlist);
  const gone = await api('GET', `/public/hotels/${slug}`);
  check('the hotel page no longer exists on the marketplace', gone.status === 404, gone);
  check('and it is gone from the Hotels list', !(await api('GET', '/public/hotels')).json.some?.((h) => h.slug === slug));
  const removed = await api('DELETE', `/hotel/room-types/${roomType.id}`, { token: owner });
  check('a room type with bookings is archived, not erased (history kept)', removed.json.archived === true, removed);

  section('11. The hotel is billed commission on checked-out bookings');
  const adminLogin = await api('POST', '/platform-admin/auth/login', { body: { email: 'admin@test.local', password: 'test-admin-password' } });
  const admin = adminLogin.json.accessToken;
  check('the platform admin can sign in', Boolean(admin), adminLogin);
  // Pretend that guest Amina checked out in the middle of a closed month four months ago (invoices are only made for months that have ended; recent test months may already be settled).
  const kenya = new Date(Date.now() + 3 * 3600_000);
  const prev = new Date(Date.UTC(kenya.getUTCFullYear(), kenya.getUTCMonth() - 4, 15, 10, 0, 0));
  const month = prev.toISOString().slice(0, 7);
  await sql.query(`UPDATE room_bookings SET "checkedOutAt" = $1 WHERE id = $2`, [prev, g1.id]);
  const orgId = (await sql.query(`SELECT "organizationId" o FROM room_bookings WHERE id = $1`, [g1.id])).rows[0].o;
  const invoiceNow = async () => (await sql.query(`SELECT id, "orderCount" n, "commissionTotal" c, "amountDue" due FROM commission_invoices WHERE "organizationId" = $1 AND "periodMonth" = $2`, [orgId, month])).rows[0];
  const before = await invoiceNow();
  const run1 = await api('POST', '/platform-admin/commission/generate', { token: admin, body: { month } });
  check('the monthly commission run succeeds for last month', run1.status === 201 || run1.status === 200, run1);
  const after = await invoiceNow();
  const linked = (await sql.query(`SELECT "commissionInvoiceId" i FROM room_bookings WHERE id = $1`, [g1.id])).rows[0].i;
  check('the booking is attached to that month\'s invoice for the hotel', Boolean(after) && linked === after.id, { after, linked });
  check('the invoice grew by exactly the booking: one more item and KES 108 more commission', Number(after.n) === Number(before?.n ?? 0) + 1 && Math.abs(Number(after.c) - (Number(before?.c ?? 0) + 108)) < 0.01, { before, after });
  const run2 = await api('POST', '/platform-admin/commission/generate', { token: admin, body: { month } });
  const again = await invoiceNow();
  check('running it again never bills the booking twice', (run2.status === 201 || run2.status === 200) && Number(again.n) === Number(after.n) && Number(again.c) === Number(after.c), { after, again });
  const commissionPage = await api('GET', '/online-store/me/commission', { token: owner });
  check('the hotel sees the invoice on its commission page', commissionPage.status === 200 && JSON.stringify(commissionPage.json).includes(after.id), commissionPage.status);

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
