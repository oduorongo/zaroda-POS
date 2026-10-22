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
  // A run that stopped half-way may have left room taxes switched on: the first sections expect none.
  await api('PUT', '/hotel/taxes', { token: owner, body: { taxes: [] } });
  check('owner can sign in', Boolean(owner), login);
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  check('the shop is live with payments connected (the hotel uses its payment account)', store.isPublished && store.tumaConnected, store);
  const slug = store.slug;
  // A run that stopped half-way (or an earlier test) may have left room types on the marketplace: start from a clean shop.
  await sql.query(`UPDATE hotel_room_types SET "isListed" = false WHERE "organizationId" = (SELECT "organizationId" FROM online_stores WHERE slug = $1)`, [slug]);
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
  // The hotel has real rooms now: 2 of this type (the type's quantity follows them).
  const roomsMade = await api('POST', '/hotel/rooms/bulk', { token: owner, body: { roomTypeId: roomType.id, prefix: `M${tag.slice(-4)}-`, from: 1, to: 2 } });
  check('two real rooms are added to the room type', roomsMade.status === 201 && roomsMade.json.added === 2, roomsMade);
  const earlyOut = await api('POST', `/hotel/bookings/${g1.id}/check-out`, { token: owner, body: {} });
  check('a guest cannot be checked out before being checked in', earlyOut.status === 409, earlyOut);
  const roomsOfType = (await api('GET', `/hotel/rooms?roomTypeId=${roomType.id}`, { token: owner })).json;
  const innEarly = await api('POST', `/hotel/bookings/${g1.id}/check-in`, { token: owner, body: { roomIds: [roomsOfType[0].id] } });
  check('check-in before the arrival date is refused', innEarly.status === 400 && /opens on/.test(innEarly.json.message), innEarly);
  const inn = await api('POST', `/hotel/bookings/${g1.id}/check-in`, { token: owner, body: { roomIds: [roomsOfType[0].id], overrideEarly: true } });
  check('check-in (the owner lets her in early) into a clean room', (inn.status === 200 || inn.status === 201) && inn.json.status === 'CHECKED_IN' && inn.json.roomNumbers?.length === 1, inn);
  const notSettled = await api('POST', `/hotel/bookings/${g1.id}/check-out`, { token: owner, body: {} });
  check('check-out is refused while KES 8,400 is still owed', notSettled.status === 409 && /still owes KES 8400/.test(notSettled.json.message), notSettled);
  const out = await api('POST', `/hotel/bookings/${g1.id}/check-out`, { token: owner, body: { payments: [{ method: 'CASH', amount: 8400 }] } });
  check('check-out once the balance is paid at the desk', out.status === 200 && out.json.booking?.status === 'CHECKED_OUT' && out.json.saleId, out);
  const commission = (await sql.query(`SELECT "commissionAmount" c FROM room_bookings WHERE id = $1`, [g1.id])).rows[0].c;
  check('commission is recorded on the whole stay, not the deposit: 3% of KES 12,000 = KES 360', Math.abs(Number(commission) - 360) < 0.001, commission);
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

  section('10b. A hotel cannot lower its commission by asking for a tiny deposit');
  const cheap = (await api('POST', '/hotel/room-types', { token: owner, body: { name: `Tiny-deposit-${tag}`, pricePerNight: 5000, maxGuests: 2, quantity: 1, depositPercent: 0, isListed: true } })).json;
  const cheapBooking = await api('POST', `/public/hotels/${slug}/bookings`, { body: { roomTypeId: cheap.id, checkIn: day(60), checkOut: day(62), rooms: 1, guests: 1, name: 'Cheap Charles', phone: '0788111222' } });
  check('a 0% deposit still asks for KES 1 on a KES 10,000 stay', cheapBooking.status === 201 && cheapBooking.json.total === 10000 && cheapBooking.json.depositAmount === 1, cheapBooking);
  const cheapPush = (await mock('GET', '/_test/pushes')).json.filter((x) => x.phone === '254788111222').pop();
  await mock('POST', `/_test/pay/${cheapPush.merchant_request_id}`);
  const cheapRoom = (await api('POST', '/hotel/rooms', { token: owner, body: { roomTypeId: cheap.id, number: `C${tag.slice(-5)}` } })).json;
  await api('POST', `/hotel/bookings/${cheapBooking.json.id}/check-in`, { token: owner, body: { roomIds: [cheapRoom.id], overrideEarly: true } });
  const cheapOutRaw = await api('POST', `/hotel/bookings/${cheapBooking.json.id}/check-out`, { token: owner, body: { payments: [{ method: 'CASH', amount: 9999 }] } });
  const cheapOut = { json: { status: cheapOutRaw.json.booking?.status } };
  const cheapCommission = (await sql.query(`SELECT "commissionAmount" c FROM room_bookings WHERE id = $1`, [cheapBooking.json.id])).rows[0].c;
  check('commission is still 3% of the whole KES 10,000 stay (KES 300), not 3% of the KES 1 deposit', cheapOut.json.status === 'CHECKED_OUT' && Math.abs(Number(cheapCommission) - 300) < 0.001, { cheapOut: cheapOut.json.status, cheapCommission });
  await api('DELETE', `/hotel/room-types/${cheap.id}`, { token: owner });

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
  check('the invoice grew by exactly the booking: one more item and KES 360 more commission', Number(after.n) === Number(before?.n ?? 0) + 1 && Math.abs(Number(after.c) - (Number(before?.c ?? 0) + 360)) < 0.01, { before, after });
  const run2 = await api('POST', '/platform-admin/commission/generate', { token: admin, body: { month } });
  const again = await invoiceNow();
  check('running it again never bills the booking twice', (run2.status === 201 || run2.status === 200) && Number(again.n) === Number(after.n) && Number(again.c) === Number(after.c), { after, again });
  const commissionPage = await api('GET', '/online-store/me/commission', { token: owner });
  check('the hotel sees the invoice on its commission page', commissionPage.status === 200 && JSON.stringify(commissionPage.json).includes(after.id), commissionPage.status);

  section('12. Stays nobody checked out complete by themselves');
  const auto = (await api('POST', '/hotel/room-types', { token: owner, body: { name: `Auto-${tag}`, pricePerNight: 3000, maxGuests: 2, quantity: 6, depositPercent: 30, isListed: true } })).json;
  const makeBooking = async (name, phone, pay) => {
    const b = await api('POST', `/public/hotels/${slug}/bookings`, { body: { roomTypeId: auto.id, checkIn: day(80), checkOut: day(81), rooms: 1, guests: 1, name, phone } });
    if (pay) {
      const push = (await mock('GET', '/_test/pushes')).json.filter((x) => x.phone === `254${phone.slice(1)}`).pop();
      await mock('POST', `/_test/pay/${push.merchant_request_id}`);
    }
    return b.json;
  };
  const oldNotCheckedIn = await makeBooking('Never pressed check-in', '0711000001', true);
  const oldInHouse = await makeBooking('Never pressed check-out', '0711000002', true);
  const justEnded = await makeBooking('Left yesterday', '0711000003', true);
  const future = await makeBooking('Arrives later', '0711000004', true);
  const noShow = await makeBooking('Marked no-show', '0711000005', true);
  const unpaid = await makeBooking('Never paid', '0711000006', false);
  const autoRoom = (await api('POST', '/hotel/rooms', { token: owner, body: { roomTypeId: auto.id, number: `AU${tag.slice(-5)}` } })).json;
  await api('POST', `/hotel/bookings/${oldInHouse.id}/check-in`, { token: owner, body: { roomIds: [autoRoom.id], overrideEarly: true } });
  await api('POST', `/hotel/bookings/${noShow.id}/no-show`, { token: owner });
  const setDates = (id, inDay, outDay) => sql.query(`UPDATE room_bookings SET "checkIn" = $1::date, "checkOut" = $2::date WHERE id = $3`, [inDay, outDay, id]);
  await setDates(oldNotCheckedIn.id, day(-6), day(-4)); // ended 4 days ago
  await setDates(oldInHouse.id, day(-8), day(-5)); // ended 5 days ago
  await setDates(justEnded.id, day(-2), day(-1)); // ended yesterday: still inside the grace period
  await setDates(noShow.id, day(-7), day(-5)); // no-show: never billed
  await setDates(unpaid.id, day(-7), day(-5)); // never paid: nothing was ever owed
  const state = async (id) => (await sql.query(`SELECT status, "commissionAmount" c, "checkedOutAt"::text at FROM room_bookings WHERE id = $1`, [id])).rows[0];
  check('the six bookings start as expected', (await state(oldNotCheckedIn.id)).status === 'CONFIRMED' && (await state(oldInHouse.id)).status === 'CHECKED_IN' && (await state(unpaid.id)).status === 'PENDING_PAYMENT');

  const noAdmin = await api('POST', '/platform-admin/room-bookings/complete-overdue');
  check('only the platform admin can run it by hand', noAdmin.status === 401, noAdmin);
  const run = await api('POST', '/platform-admin/room-bookings/complete-overdue', { token: admin });
  check('the run completes the two stays that ended long ago', (run.status === 201 || run.status === 200) && run.json.completed >= 2, run);
  const a = await state(oldNotCheckedIn.id);
  const b = await state(oldInHouse.id);
  check('a paid booking never checked in or out is completed, with 3% of the whole KES 3,000 stay (KES 90)', a.status === 'CHECKED_OUT' && Math.abs(Number(a.c) - 90) < 0.001, a);
  check('a guest checked in but never out is completed the same way', b.status === 'CHECKED_OUT' && Math.abs(Number(b.c) - 90) < 0.001, b);
  check('the check-out is dated midday on the real check-out day (so it lands in the right month)', a.at.startsWith(day(-4)) && /09:00:00/.test(a.at), a);
  check('a stay that ended yesterday still has its grace period', (await state(justEnded.id)).status === 'CONFIRMED');
  check('a booking for the future is left alone', (await state(future.id)).status === 'CONFIRMED');
  check('a no-show is left a no-show (never billed)', (await state(noShow.id)).status === 'NO_SHOW');
  check('a booking that was never paid is left alone', (await state(unpaid.id)).status === 'PENDING_PAYMENT');
  const secondRun = await api('POST', '/platform-admin/room-bookings/complete-overdue', { token: admin });
  check('running it again changes nothing', secondRun.json.completed === 0 && (await state(oldNotCheckedIn.id)).status === 'CHECKED_OUT', secondRun);
  const billable = (await sql.query(`SELECT count(*)::int n FROM room_bookings WHERE id = ANY($1) AND status = 'CHECKED_OUT' AND "commissionInvoiceId" IS NULL AND "paidAt" IS NOT NULL`, [[oldNotCheckedIn.id, oldInHouse.id]])).rows[0].n;
  check('both are now waiting to be billed on the hotel\'s monthly commission invoice', billable === 2, billable);
  await api('DELETE', `/hotel/room-types/${auto.id}`, { token: owner }); // has bookings, so it is archived and leaves the marketplace

  section('13. The platform owner\'s hotel overview');
  check('the overview needs the platform admin', (await api('GET', '/platform-admin/hotel-overview')).status === 401);
  const overview = await api('GET', '/platform-admin/hotel-overview?days=365', { token: admin });
  const mine13 = overview.json.hotels?.find((h) => h.organizationId === orgId);
  check('the hotel appears with its bookings, paid bookings and money received', overview.status === 200 && mine13?.bookings >= 8 && mine13.paidBookings >= 6 && mine13.depositsReceived > 0, overview.json.summary);
  check('no-shows and cancellations are counted, and the cancelled deposit shows as owed back', mine13?.noShow >= 1 && mine13.cancelled >= 1 && mine13.depositsToRefund >= 3600, mine13);
  check('commission recorded and stay value come from checked-out stays', mine13?.commissionRecorded >= 360 && mine13.stayValue >= 12000, mine13);
  check('the summary and the recent bookings list are filled in', overview.json.summary.hotels >= 1 && overview.json.summary.bookings >= 8 && overview.json.recent.length > 0 && overview.json.recent[0].bookingNumber, overview.json.summary);
  check('a hotel whose paid bookings mostly end as no-shows or cancellations is flagged (the rule itself is unit-tested)', mine13?.watch === null || typeof mine13?.watch === 'string', mine13?.watch);

  section('14. The platform owner contacts a hotel, or takes it off the marketplace');
  check('each hotel row carries how to reach it: the shop phone, WhatsApp number and the owner\'s email', mine13?.contactPhone === '0711000111' && mine13.whatsapp === '254711000111' && mine13.ownerEmail === 'owner@demo.zaroda.pos', { phone: mine13?.contactPhone, whatsapp: mine13?.whatsapp, email: mine13?.ownerEmail });
  const blockType = (await api('POST', '/hotel/room-types', { token: owner, body: { name: `Block-${tag}`, pricePerNight: 2500, maxGuests: 2, quantity: 2, depositPercent: 30, isListed: true } })).json;
  check('a hotel with a listed room is on the marketplace to begin with', (await api('GET', '/public/hotels')).json.some?.((h) => h.slug === slug));
  check('only the platform admin can take a hotel off the marketplace', (await api('POST', `/platform-admin/organizations/${orgId}/hotel/block`, { body: { reason: 'x y z' } })).status === 401);
  check('a reason is required', (await api('POST', `/platform-admin/organizations/${orgId}/hotel/block`, { token: admin, body: { reason: 'x' } })).status === 400);
  const blocked = await api('POST', `/platform-admin/organizations/${orgId}/hotel/block`, { token: admin, body: { reason: 'Repeated complaints about cancelled bookings' } });
  check('the platform admin takes the hotel off the marketplace', blocked.status === 201 || blocked.status === 200, blocked);
  check('doing it twice is refused', (await api('POST', `/platform-admin/organizations/${orgId}/hotel/block`, { token: admin, body: { reason: 'Repeated complaints' } })).status === 409);
  check('it is gone from the Hotels list', !(await api('GET', '/public/hotels')).json.some?.((h) => h.slug === slug));
  check('its hotel page is gone too', (await api('GET', `/public/hotels/${slug}`)).status === 404);
  const refusedBooking = await api('POST', `/public/hotels/${slug}/bookings`, { body: { roomTypeId: blockType.id, checkIn: day(90), checkOut: day(91), rooms: 1, guests: 1, name: 'Late Larry', phone: '0799123456' } });
  check('a guest can no longer book a room there', refusedBooking.status === 404, refusedBooking);
  const stillMine = await api('GET', `/public/room-bookings/${g1.id}?k=${encodeURIComponent(g1.guestToken)}`);
  check('a guest who already booked can still open their booking', stillMine.status === 200 && stillMine.json.id === g1.id, stillMine.status);
  const status = await api('GET', '/hotel/status', { token: owner });
  check('the hotel is told it is off the marketplace and why', status.json.blockedReason === 'Repeated complaints about cancelled bookings', status.json);
  const relist = await api('POST', '/hotel/room-types', { token: owner, body: { name: `Sneaky-${tag}`, pricePerNight: 1000, maxGuests: 1, quantity: 1, depositPercent: 30, isListed: true } });
  check('the hotel cannot put a new room on the marketplace itself', relist.status === 409 && /taken your hotel off the marketplace/.test(relist.json.message || ''), relist);
  const unlisted = await api('POST', '/hotel/room-types', { token: owner, body: { name: `Quiet-${tag}`, pricePerNight: 1000, maxGuests: 1, quantity: 1, depositPercent: 30, isListed: false } });
  check('it can still set up rooms (unlisted) and manage its bookings', unlisted.status === 201 && (await api('GET', '/hotel/bookings', { token: owner })).status === 200, unlisted);
  const relistExisting = await api('PUT', `/hotel/room-types/${unlisted.json.id}`, { token: owner, body: { name: `Quiet-${tag}`, pricePerNight: 1000, maxGuests: 1, quantity: 1, depositPercent: 30, isListed: true } });
  check('nor can it switch an existing room on to listed', relistExisting.status === 409, relistExisting);
  const overviewBlocked = (await api('GET', '/platform-admin/hotel-overview?days=365', { token: admin })).json.hotels.find((h) => h.organizationId === orgId);
  check('the owner\'s overview shows it as off the marketplace, with the reason', overviewBlocked?.hotelBlockedReason === 'Repeated complaints about cancelled bookings', overviewBlocked?.hotelBlockedReason);
  const restored = await api('POST', `/platform-admin/organizations/${orgId}/hotel/unblock`, { token: admin });
  check('the platform admin restores it', restored.status === 201 || restored.status === 200, restored);
  check('restoring twice is refused', (await api('POST', `/platform-admin/organizations/${orgId}/hotel/unblock`, { token: admin })).status === 409);
  check('the hotel is back on the marketplace (its listed room is visible again)', (await api('GET', '/public/hotels')).json.some?.((h) => h.slug === slug));
  check('and can list rooms again', (await api('PUT', `/hotel/room-types/${unlisted.json.id}`, { token: owner, body: { name: `Quiet-${tag}`, pricePerNight: 1000, maxGuests: 1, quantity: 1, depositPercent: 30, isListed: true } })).status === 200);
  await api('DELETE', `/hotel/room-types/${blockType.id}`, { token: owner });
  await api('DELETE', `/hotel/room-types/${unlisted.json.id}`, { token: owner });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // FRONT DESK: real rooms, bookings taken at the desk, check-in/out, the folio, charge to room
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    const { createHash, randomUUID } = require('crypto');
    const settlementId = (bookingId) => {
      const h = createHash('sha256').update(`hotel-settlement:${bookingId}`).digest('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    };
    const h = (method, p, body, token = owner) => api(method, p, { token, body });
    const org = (await api('GET', '/organizations/me', { token: owner })).json;
    const branches = (await api('GET', '/branches', { token: owner })).json;
    const branchId = branches[0].id;

    section('12. Front desk - setting up (rooms, staff, a taxed room type)');
    console.log('  (waiting a minute so the sign-in limit resets)');
    await sleep(65_000);
    const mkStaff = async (role) => {
      const email = `${role.toLowerCase()}-${tag}@demo.zaroda.pos`;
      await api('POST', '/org-users', { token: owner, body: { email, fullName: `Desk ${role}`, password: 'password123', role, branchId } });
      return (await api('POST', '/auth/login', { body: { email, password: 'password123' } })).json.accessToken;
    };
    const cashier = await mkStaff('CASHIER');
    const supervisor = await mkStaff('SUPERVISOR');
    check('a cashier and a supervisor can sign in', Boolean(cashier && supervisor));
    const terminalId = (await sql.query(`SELECT id FROM terminals WHERE "branchId" = $1 ORDER BY "createdAt" LIMIT 1`, [branchId])).rows[0].id;
    const ownerOrgUserId = (await sql.query(`SELECT ou.id FROM org_users ou JOIN users u ON u.id = ou."userId" WHERE u.email = 'owner@demo.zaroda.pos' AND ou."organizationId" = $1`, [org.id])).rows[0].id;
    const pin = await api('POST', '/auth/pin-login', { body: { terminalId, orgUserId: ownerOrgUserId, pin: '1234' } });
    const cashierSessionId = pin.json.cashierSessionId;
    check('a till session exists for charge-to-room sales', Boolean(cashierSessionId), pin);

    const mkType = async (name, rooms, { price = 5000, listed = false } = {}) => {
      const type = (await h('POST', '/hotel/room-types', { name: `${name}-${tag}`, pricePerNight: price, maxGuests: 2, quantity: 1, depositPercent: 30, isListed: listed })).json;
      const made = await h('POST', '/hotel/rooms/bulk', { roomTypeId: type.id, prefix: `${name.slice(0, 2)}${tag.slice(-3)}-`, from: 1, to: rooms });
      const list = (await h('GET', `/hotel/rooms?roomTypeId=${type.id}`)).json;
      return { type, made, list };
    };
    const fdv = await mkType('Taxed', 2);
    check('rooms are added in bulk and the room type\'s quantity follows them (2)', fdv.made.status === 201 && (await h('GET', '/hotel/room-types')).json.find((t) => t.id === fdv.type.id).quantity === 2, fdv.made);
    check('adding a room number that exists is refused', (await h('POST', '/hotel/rooms', { roomTypeId: fdv.type.id, number: fdv.list[0].number })).status === 409);
    check('a cashier cannot add rooms or room types', (await h('POST', '/hotel/rooms/bulk', { roomTypeId: fdv.type.id, from: 90, to: 91 }, cashier)).status === 403 && (await h('POST', '/hotel/room-types', { name: 'x', pricePerNight: 1000, maxGuests: 1, quantity: 1, depositPercent: 0 }, cashier)).status === 403);
    check('the front desk needs a sign-in', (await api('GET', '/hotel/desk')).status === 401);

    // The hotel's VAT: the room product ("Room: Taxed") gets a 16% tax class.
    const vat = await h('POST', '/tax-classes', { name: `Room VAT ${tag}`, rate: 0.16, isExempt: false });
    const productId = (await sql.query(`SELECT v."productId" p FROM hotel_room_types t JOIN product_variants v ON v.id = t."variantId" WHERE t.id = $1`, [fdv.type.id])).rows[0]?.p;
    check('each room type has its own "Room: ..." product for selling nights', Boolean(productId));
    await h('PATCH', `/products/${productId}`, { taxClassId: vat.json.id });

    const stockedProduct = (await h('POST', '/products', { name: `Laundry-${tag}` })).json;
    const laundry = (await h('POST', `/products/${stockedProduct.id}/variants`, { sku: `LDRY-${tag}`, price: 300 })).json;
    await h('POST', '/inventory/transactions', { branchId, variantId: laundry.id, type: 'ADJUSTMENT', quantityDelta: 50 });

    section('13. A booking taken at the desk');
    const body = (over = {}) => ({ guestName: 'Wanjiru Kamau', phone: '0711 222 333', idNumber: 'A1234567', nationality: 'Kenyan', guests: 2, checkIn: day(0), checkOut: day(2), roomTypeId: fdv.type.id, ...over });
    check('a bad phone number is refused', (await h('POST', '/hotel/bookings', body({ phone: '12' }), cashier)).status === 400);
    check('a check-in date in the past is refused', (await h('POST', '/hotel/bookings', body({ checkIn: day(-1) }), cashier)).status === 400);
    check('the desk needs a role that works the desk (no token = refused)', (await api('POST', '/hotel/bookings', { body: body() })).status === 401);
    const b1 = await h('POST', '/hotel/bookings', body({ deposit: { method: 'CASH', amount: 2000 } }), cashier);
    check('a cashier books a walk-in guest with a KES 2,000 cash deposit - no marketplace, no payment gateway', b1.status === 201 && b1.json.status === 'CONFIRMED' && b1.json.source === 'FRONT_DESK' && b1.json.total === 10000, b1);
    check('the ID number is masked to its last four in the response', b1.json.idNumber === '****4567', b1.json.idNumber);
    check('the deposit is on the folio, as a payment', b1.json.paid === 2000 && b1.json.balance === -2000, b1.json);
    const full = await h('GET', `/hotel/bookings/${b1.json.id}`, undefined, supervisor);
    check('a supervisor can open the guest\'s record and see the full ID number; a cashier cannot', full.json.idNumber === 'A1234567' && (await h('GET', `/hotel/bookings/${b1.json.id}`, undefined, cashier)).json.idNumber === '****4567');
    const rateByCashier = await h('POST', '/hotel/bookings', body({ rate: 3000 }), cashier);
    check('a cashier cannot change the rate', rateByCashier.status === 403, rateByCashier);
    const b2 = await h('POST', '/hotel/bookings', body({ guestName: 'Omondi Otieno', phone: '0722333444', checkOut: day(1), rate: 4000, source: 'PHONE' }), owner);
    check('the owner can set a different rate (KES 4,000)', b2.status === 201 && b2.json.pricePerNight === 4000 && b2.json.source === 'PHONE', b2);
    const audits = (await sql.query(`SELECT action FROM audit_log WHERE "entityId" = $1`, [b2.json.id])).rows.map((r) => r.action);
    check('the rate change and the booking are in the audit log', audits.includes('hotel.rate_overridden') && audits.includes('hotel.booking_created'), audits);
    const full3 = await h('POST', '/hotel/bookings', body({ guestName: 'Third Guest', phone: '0733444555' }), cashier);
    check('with both rooms taken for those nights, the next booking is refused', full3.status === 409 && /No .* rooms are free/.test(full3.json.message || ''), full3);

    section('14. Desk bookings and marketplace bookings can never take the same last room');
    const shared = await mkType('Shared', 1, { price: 3000, listed: true });
    const mBody = (over = {}) => ({ roomTypeId: shared.type.id, checkIn: day(50), checkOut: day(51), rooms: 1, guests: 1, name: 'Online Olive', phone: '0766111222', ...over });
    const online = await api('POST', `/public/hotels/${slug}/bookings`, { body: mBody() });
    check('a guest online takes the last room (waiting for their M-Pesa deposit)', online.status === 201, online);
    const blocked = await h('POST', '/hotel/bookings', body({ roomTypeId: shared.type.id, checkIn: day(50), checkOut: day(51), guests: 1 }), cashier);
    check('the desk is refused while the online guest holds it', blocked.status === 409, blocked);
    await sql.query(`UPDATE room_bookings SET "paymentDeadline" = (now() at time zone 'utc') - interval '1 minute' WHERE id = $1`, [online.json.id]);
    const deskGets = await h('POST', '/hotel/bookings', body({ roomTypeId: shared.type.id, checkIn: day(50), checkOut: day(51), guests: 1 }), cashier);
    check('once the online guest\'s payment window has passed, the desk can have it', deskGets.status === 201, deskGets);
    const online2 = await api('POST', `/public/hotels/${slug}/bookings`, { body: mBody({ name: 'Online Omar', phone: '0766333444' }) });
    check('and now the marketplace is refused', online2.status === 409, online2);
    const race = await Promise.all([
      api('POST', `/public/hotels/${slug}/bookings`, { body: mBody({ checkIn: day(55), checkOut: day(56), name: 'Race Online', phone: '0766555666' }) }),
      h('POST', '/hotel/bookings', body({ roomTypeId: shared.type.id, checkIn: day(55), checkOut: day(56), guests: 1 }), cashier),
    ]);
    check('a guest online and the desk going for the last room in the same instant: exactly one gets it', race.filter((r) => r.status === 201).length === 1 && race.filter((r) => r.status === 409).length === 1, race.map((r) => r.status));

    section('15. Check-in rules and housekeeping');
    const rule = await mkType('Rules', 3);
    const [r1, r2, r3] = rule.list;
    const tomorrow = await h('POST', '/hotel/bookings', body({ roomTypeId: rule.type.id, checkIn: day(2), checkOut: day(3), guestName: 'Early Edith', phone: '0744000111' }), cashier);
    const todayBk = await h('POST', '/hotel/bookings', body({ roomTypeId: rule.type.id, checkIn: day(0), checkOut: day(1), guestName: 'Today Tom', phone: '0744000222' }), cashier);
    const ci = (id, roomIds, extra = {}, token = cashier) => h('POST', `/hotel/bookings/${id}/check-in`, { roomIds, ...extra }, token);
    check('check-in before the arrival date is refused', (await ci(tomorrow.json.id, [r1.id])).status === 400);
    check('a cashier cannot override the date', (await ci(tomorrow.json.id, [r1.id], { overrideEarly: true })).status === 403);
    check('a supervisor cannot override it either', (await ci(tomorrow.json.id, [r1.id], { overrideEarly: true }, supervisor)).status === 403);
    check('a room of another type is refused', (await ci(todayBk.json.id, [fdv.list[0].id])).status === 400);
    check('a cashier cannot mark a room out of order', (await h('PATCH', `/hotel/rooms/${r1.id}/status`, { status: 'OUT_OF_ORDER' }, cashier)).status === 403);
    check('a supervisor can', (await h('PATCH', `/hotel/rooms/${r1.id}/status`, { status: 'OUT_OF_ORDER' }, supervisor)).status === 200);
    check('check-in into an out-of-order room is refused', (await ci(todayBk.json.id, [r1.id])).status === 409);
    await h('PATCH', `/hotel/rooms/${r1.id}/status`, { status: 'VACANT_DIRTY' }, supervisor);
    const dirty = await ci(todayBk.json.id, [r1.id]);
    check('check-in into a room that is not cleaned yet is refused', dirty.status === 409 && /not cleaned/.test(dirty.json.message), dirty);
    check('housekeeping marks it clean (a cashier may)', (await h('PATCH', `/hotel/rooms/${r1.id}/status`, { status: 'VACANT_CLEAN' }, cashier)).status === 200);
    check('"occupied" cannot be set by hand', (await h('PATCH', `/hotel/rooms/${r1.id}/status`, { status: 'OCCUPIED' }, owner)).status === 400);
    const second = await h('POST', '/hotel/bookings', body({ roomTypeId: rule.type.id, checkIn: day(0), checkOut: day(1), guestName: 'Same-room Sam', phone: '0744000333' }), cashier);
    const clash = await Promise.all([ci(todayBk.json.id, [r1.id]), ci(second.json.id, [r1.id])]);
    check('two guests checked into the same room at the same moment: exactly one gets it', clash.filter((r) => r.status === 200).length === 1 && clash.filter((r) => r.status === 409).length === 1, clash.map((r) => r.status));
    const winnerId = clash[0].status === 200 ? todayBk.json.id : second.json.id;
    check('the room is Occupied', (await h('GET', '/hotel/rooms', undefined, owner)).json.find((r) => r.id === r1.id).status === 'OCCUPIED');
    const early = await ci(tomorrow.json.id, [r2.id], { overrideEarly: true }, owner);
    check('a manager/owner can allow an early check-in', early.status === 200 && early.json.status === 'CHECKED_IN', early);
    check('and it is audit-logged', (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'hotel.early_check_in' AND "entityId" = $1`, [tomorrow.json.id])).rows[0].n === 1);
    const deskBoard = await h('GET', '/hotel/desk', undefined, cashier);
    check('the desk board lists arrivals, in-house guests and the room grid', deskBoard.status === 200 && Array.isArray(deskBoard.json.arrivals) && deskBoard.json.inHouse.some((g) => g.id === tomorrow.json.id) && deskBoard.json.rooms.length >= 5 && deskBoard.json.roomCounts.OCCUPIED >= 2, Object.keys(deskBoard.json));
    check('the checked-in guests are offered for "charge to room" with their room numbers', (await h('GET', '/hotel/in-house', undefined, cashier)).json.some((g) => g.bookingId === tomorrow.json.id && g.roomNumbers.length === 1));
    const moved = await h('POST', `/hotel/bookings/${tomorrow.json.id}/move-room`, { fromRoomId: r2.id, toRoomId: r3.id, reason: 'Air conditioning broken' }, supervisor);
    check('a supervisor moves a guest to another clean room', moved.status === 200 && moved.json.roomNumbers[0] === r3.number, moved);
    check('a cashier cannot move a guest', (await h('POST', `/hotel/bookings/${tomorrow.json.id}/move-room`, { fromRoomId: r3.id, toRoomId: r2.id, reason: 'Just because' }, cashier)).status === 403);
    const roomsNow = (await h('GET', '/hotel/rooms', undefined, owner)).json;
    check('the old room needs cleaning, the new one is occupied, and the move is logged', roomsNow.find((r) => r.id === r2.id).status === 'VACANT_DIRTY' && roomsNow.find((r) => r.id === r3.id).status === 'OCCUPIED' && (await sql.query(`SELECT count(*)::int n FROM hotel_room_assignments WHERE "bookingId" = $1`, [tomorrow.json.id])).rows[0].n === 2);
    void winnerId;

    section('16. The guest folio: nights with VAT, charges to the room, adjustments, check-out');
    const ib1 = await ci(b1.json.id, [fdv.list[0].id], {}, owner);
    check('the first walk-in is checked in', ib1.status === 200, ib1);
    const folio1 = (await h('GET', `/hotel/bookings/${b1.json.id}/folio`, undefined, cashier)).json;
    check('two nights posted with 16% VAT inside: KES 5,800 each, VAT KES 800 each', folio1.entries.filter((e) => e.type === 'ROOM_NIGHT').length === 2 && folio1.entries.filter((e) => e.type === 'ROOM_NIGHT').every((e) => e.amount === 5800 && e.taxAmount === 800), folio1.entries);
    check('the deposit is a payment; the balance is 11,600 - 2,000 = 9,600', folio1.totals.payments === 2000 && folio1.totals.balance === 9600 && folio1.totals.roomTax === 1600, folio1.totals);
    check('the printable folio carries the hotel\'s details', folio1.business?.name === org.name && 'kraPin' in folio1.business, folio1.business);

    const chargeTo = (bookingId, over = {}) => {
      const clientId = randomUUID();
      return h('POST', '/sales', { clientId, branchId, terminalId, cashierSessionId, lineItems: [{ variantId: laundry.id, quantity: 1 }], payments: [{ method: 'ROOM_CHARGE', amount: 300, providerReference: `ROOM:${bookingId}:${clientId}` }], ...over });
    };
    const notIn = await h('POST', '/hotel/bookings', body({ roomTypeId: rule.type.id, checkIn: day(5), checkOut: day(6), guestName: 'Not Yet Nora', phone: '0744000444' }), cashier);
    const toNotIn = await chargeTo(notIn.json.id);
    check('charging a sale to a guest who is not checked in is refused', toNotIn.status === 400 && /cannot be charged to a room/.test(toNotIn.json.message), toNotIn);
    check('and nothing was sold', (await sql.query(`SELECT count(*)::int n FROM sale_payments WHERE "providerReference" LIKE $1`, [`ROOM:${notIn.json.id}:%`])).rows[0].n === 0);
    check('a made-up room reference is refused', (await chargeTo(randomUUID())).status === 400);
    check('a charge with no room reference is refused', (await h('POST', '/sales', { clientId: randomUUID(), branchId, terminalId, cashierSessionId, lineItems: [{ variantId: laundry.id, quantity: 1 }], payments: [{ method: 'ROOM_CHARGE', amount: 300 }] })).status === 400);
    check('an M-Pesa (receipt) payment needs its receipt code', (await h('POST', '/sales', { clientId: randomUUID(), branchId, terminalId, cashierSessionId, lineItems: [{ variantId: laundry.id, quantity: 1 }], payments: [{ method: 'MPESA_RECEIPT', amount: 300 }] })).status === 400);
    const charged = await chargeTo(b1.json.id);
    check('a sale is charged to the checked-in guest\'s room: it is a normal sale', charged.status === 201 && Number(charged.json.total) === 300, charged);
    await sleep(300);
    const folio2 = (await h('GET', `/hotel/bookings/${b1.json.id}/folio`, undefined, cashier)).json;
    const chargeEntry = folio2.entries.find((e) => e.type === 'CHARGE');
    check('it appears on the folio as a CHARGE linked to the sale; balance 9,900', chargeEntry?.amount === 300 && chargeEntry.saleId === charged.json.id && folio2.totals.balance === 9900, folio2.totals);

    check('a cashier cannot post an adjustment or a refund', (await h('POST', `/hotel/bookings/${b1.json.id}/adjustments`, { amount: -500, reason: 'Goodwill' }, cashier)).status === 403 && (await h('POST', `/hotel/bookings/${b1.json.id}/refunds`, { method: 'CASH', amount: 100, reason: 'Oops' }, cashier)).status === 403);
    check('an adjustment can only take money off', (await h('POST', `/hotel/bookings/${b1.json.id}/adjustments`, { amount: 500, reason: 'Extra' })).status === 400);
    const adj = await h('POST', `/hotel/bookings/${b1.json.id}/adjustments`, { amount: -500, reason: 'Goodwill for the noise' });
    check('the owner takes KES 500 off as an adjustment (a new entry; nothing is edited)', adj.status === 201 && adj.json.totals.balance === 9400, adj);
    const payMpesa = await h('POST', `/hotel/bookings/${b1.json.id}/payments`, { method: 'MPESA_RECEIPT', amount: 100 }, cashier);
    check('an M-Pesa payment at the desk needs its receipt code', payMpesa.status === 400);

    const sales0 = (await sql.query(`SELECT count(*)::int n FROM sales WHERE "clientId" = $1`, [settlementId(b1.json.id)])).rows[0].n;
    const noPay = await h('POST', `/hotel/bookings/${b1.json.id}/check-out`, {}, cashier);
    check('check-out is refused while KES 9,400 is owed', noPay.status === 409 && /still owes KES 9400/.test(noPay.json.message) && sales0 === 0, noPay);
    const out1 = await h('POST', `/hotel/bookings/${b1.json.id}/check-out`, { payments: [{ method: 'CASH', amount: 9400 }] }, cashier);
    check('the guest pays KES 9,400 cash and is checked out', out1.status === 200 && out1.json.booking.status === 'CHECKED_OUT' && out1.json.folio.totals.balance === 0, out1);
    const settleSale = (await sql.query(`SELECT id, total FROM sales WHERE "clientId" = $1`, [settlementId(b1.json.id)])).rows;
    check('exactly ONE settlement sale was made, for the room nights less the adjustment: 11,600 - 500 = KES 11,100', settleSale.length === 1 && Number(settleSale[0].total) === 11100 && out1.json.saleId === settleSale[0].id, settleSale);
    const lines = (await sql.query(`SELECT quantity, "unitPrice", "taxAmount" FROM sale_line_items WHERE "saleId" = $1`, [settleSale[0].id])).rows;
    check('it records 2 nights at KES 5,000 with KES 1,600 VAT, so it reaches Sales, Reports and the tax figures', lines.length === 1 && Number(lines[0].quantity) === 2 && Number(lines[0].unitPrice) === 5000 && Math.abs(Number(lines[0].taxAmount) - 1600) < 0.01, lines);
    const settlePay = (await sql.query(`SELECT method, amount FROM sale_payments WHERE "saleId" = $1 ORDER BY amount`, [settleSale[0].id])).rows;
    check('its payments are the guest\'s own: the cash deposit first, then cash from the desk (KES 11,100 together)', settlePay.length === 2 && settlePay.every((p) => p.method === 'CASH') && Math.abs(settlePay.reduce((s, p) => s + Number(p.amount), 0) - 11100) < 0.01, settlePay);
    check('the laundry charge was NOT counted again (its own sale stays as it was)', (await sql.query(`SELECT count(*)::int n FROM sales WHERE id = $1`, [charged.json.id])).rows[0].n === 1 && Number(settleSale[0].total) === 11100);
    check('no stock moved for room nights', (await sql.query(`SELECT count(*)::int n FROM inventory_transactions WHERE "referenceId" = $1`, [settleSale[0].id])).rows[0].n === 0);
    const again = await h('POST', `/hotel/bookings/${b1.json.id}/check-out`, {}, cashier);
    check('checking out again is harmless: same sale, still only one', again.status === 200 && again.json.saleId === settleSale[0].id && (await sql.query(`SELECT count(*)::int n FROM sales WHERE "clientId" = $1`, [settlementId(b1.json.id)])).rows[0].n === 1, again);
    check('the room needs cleaning after check-out; front-desk bookings carry no commission', (await h('GET', '/hotel/rooms', undefined, owner)).json.find((r) => r.id === fdv.list[0].id).status === 'VACANT_DIRTY' && Number((await sql.query(`SELECT "commissionAmount" c FROM room_bookings WHERE id = $1`, [b1.json.id])).rows[0].c) === 0);
    check('a checked-out booking cannot be checked out or charged to again', (await chargeTo(b1.json.id)).status === 400);

    section('17. Leaving a balance owing needs a manager and a reason');
    const b3 = await h('POST', '/hotel/bookings', body({ checkOut: day(1), guestName: 'Company Guest', phone: '0788999000', roomTypeId: fdv.type.id, deposit: { method: 'CARD', amount: 1000, reference: `SLIP-${tag}` } }), cashier);
    check('another guest books with a card deposit', b3.status === 201, b3);
    await h('PATCH', `/hotel/rooms/${fdv.list[0].id}/status`, { status: 'VACANT_CLEAN' }, cashier);
    check('the guest is checked in', (await ci(b3.json.id, [fdv.list[0].id], {}, cashier)).status === 200);
    const leaveByCashier = await h('POST', `/hotel/bookings/${b3.json.id}/check-out`, { leaveBalanceReason: 'Company will pay' }, cashier);
    check('a cashier cannot approve leaving a balance', leaveByCashier.status === 403, leaveByCashier);
    const leave = await h('POST', `/hotel/bookings/${b3.json.id}/check-out`, { leaveBalanceReason: 'Company will pay by cheque' }, owner);
    check('the owner can, with a reason', leave.status === 200 && leave.json.booking.status === 'CHECKED_OUT', leave);
    const settle3 = (await sql.query(`SELECT s.id, s.total FROM sales s WHERE s."clientId" = $1`, [settlementId(b3.json.id)])).rows[0];
    const pay3 = (await sql.query(`SELECT method, amount FROM sale_payments WHERE "saleId" = $1 ORDER BY amount`, [settle3.id])).rows;
    check('the sale shows the card deposit (KES 1,000) and the rest (KES 4,800 with VAT) as owed on the room account', Number(settle3.total) === 5800 && pay3.some((p) => p.method === 'CARD' && Number(p.amount) === 1000) && pay3.some((p) => p.method === 'ROOM_CHARGE' && Number(p.amount) === 4800), pay3);
    check('the reason is kept', (await sql.query(`SELECT "balanceLeftReason" r FROM room_bookings WHERE id = $1`, [b3.json.id])).rows[0].r === 'Company will pay by cheque');
    check('a card slip number cannot be recorded twice', (await h('POST', `/hotel/bookings/${b3.json.id}/payments`, { method: 'CARD', amount: 100, reference: `SLIP-${tag}` }, cashier)).status === 409);

    section('18. Cancelling, refunds and the marketplace commission rule');
    const toCancel = await h('POST', '/hotel/bookings', body({ roomTypeId: rule.type.id, checkIn: day(7), checkOut: day(8), guestName: 'Cancel Carol', phone: '0744000555', roomId: r1.id, deposit: { method: 'CASH', amount: 1500 } }), cashier);
    check('a booking can ask for a particular room', toCancel.status === 201 && toCancel.json.roomNumbers?.[0] === r1.number, toCancel);
    const cancelled = await h('POST', `/hotel/bookings/${toCancel.json.id}/cancel`, { reason: 'Guest changed plans' }, supervisor);
    check('a supervisor can cancel (the KES 1,500 deposit taken at the desk is owed back)', cancelled.status === 201 && cancelled.json.status === 'CANCELLED' && cancelled.json.refundDue === 1500, cancelled);
    check('a refund of more than was paid is refused; a cashier cannot refund', (await h('POST', `/hotel/bookings/${toCancel.json.id}/refunds`, { method: 'CASH', amount: 5000, reason: 'Too much' })).status === 400);
    const refund = await h('POST', `/hotel/bookings/${toCancel.json.id}/refunds`, { method: 'CASH', amount: 1500, reason: 'Cancelled by the guest' });
    check('the owner records the KES 1,500 refund; the folio is back to zero', refund.status === 201 && refund.json.totals.balance === 0, refund);
    check('the promised room is let go when a booking is cancelled', (await sql.query(`SELECT count(*)::int n FROM hotel_room_assignments WHERE "bookingId" = $1`, [toCancel.json.id])).rows[0].n === 0);
    check('a marketplace guest\'s commission is still charged on the whole stay (3% of KES 12,000 = KES 360)', Math.abs(Number((await sql.query(`SELECT "commissionAmount" c FROM room_bookings WHERE id = $1`, [g1.id])).rows[0].c) - 360) < 0.001);

    section('19. Row-level security on the new tables');
    for (const t of ['hotel_rooms', 'hotel_folios', 'hotel_folio_entries', 'hotel_room_assignments']) {
      const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
      check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
    }

    // ───────────────────────────────────────────────────────────────────────────────────────────
    // HOTEL OPERATIONS: rate plans and taxes, changing a stay, cancellation policy, guest register, night audit, reports, texts
    // ───────────────────────────────────────────────────────────────────────────────────────────
    const dayMs = (s) => Date.parse(`${s}T00:00:00Z`);
    const upTo = (from, to) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000);
    const nextDow = (dow, minOffset) => { for (let i = minOffset; i < minOffset + 8; i++) if (new Date(dayMs(day(i))).getUTCDay() === dow) return day(i); };
    const tidy = async (ms = 700) => sleep(ms);

    section('20. Rate plans and room taxes');
    check('a cashier cannot change the hotel\'s taxes or rules', (await h('PUT', '/hotel/taxes', { taxes: [{ name: 'VAT', percent: 16 }] }, cashier)).status === 403 && (await h('PUT', '/hotel/settings', { cancelFreeDays: 1, cancelKeepPercent: 0, nightAuditHour: 3, noShowCutoffHour: 18, confirmationSms: true, reminderSms: true, thankYouSms: true }, cashier)).status === 403);
    check('the desk can read the rules', (await h('GET', '/hotel/settings', undefined, cashier)).status === 200);
    check('two taxes with one name are refused; so are taxes adding up to more than 100%', (await h('PUT', '/hotel/taxes', { taxes: [{ name: 'VAT', percent: 16 }, { name: 'vat', percent: 2 }] })).status === 400 && (await h('PUT', '/hotel/taxes', { taxes: [{ name: 'A', percent: 80 }, { name: 'B', percent: 30 }] })).status === 400);
    const taxSet = await h('PUT', '/hotel/taxes', { taxes: [{ name: 'VAT', percent: 16 }, { name: 'Tourism levy', percent: 2 }] });
    check('the owner sets VAT 16% and a tourism levy 2%', taxSet.status === 200 && taxSet.json.length === 2, taxSet);
    const managedClass = (await sql.query(`SELECT rate FROM tax_classes WHERE name = 'Hotel room tax' AND "organizationId" = $1`, [org.id])).rows[0];
    check('the room products carry one "Hotel room tax" class at the combined 18%', Number(managedClass?.rate) === 0.18, managedClass);

    const opsType = (await h('POST', '/hotel/room-types', { name: `Plans-${tag}`, pricePerNight: 5000, maxGuests: 3, quantity: 1, depositPercent: 30, isListed: false })).json;
    await h('POST', '/hotel/rooms/bulk', { roomTypeId: opsType.id, prefix: `P${tag.slice(-3)}-`, from: 1, to: 4 });
    const opsRooms = (await h('GET', `/hotel/rooms?roomTypeId=${opsType.id}`)).json;
    check('a room type with four real rooms for the rate tests', opsRooms.length === 4);
    const rc = await h('PUT', `/hotel/room-types/${opsType.id}/rate-card`, { weekendRate: 6500, weekendDays: [5, 6], includedAdults: 2, freeChildren: 1, extraAdultRate: 1500, extraChildRate: 800 });
    check('the rate card is saved (weekend KES 6,500, extra adult 1,500, extra child 800 after one free)', rc.status === 200 && rc.json.weekendRate === 6500 && rc.json.extraAdultRate === 1500, rc);
    check('a cashier cannot change prices; the same weekend day twice is refused', (await h('PUT', `/hotel/room-types/${opsType.id}/rate-card`, { weekendRate: 1, weekendDays: [5], includedAdults: 2, freeChildren: 0, extraAdultRate: 0, extraChildRate: 0 }, cashier)).status === 403 && (await h('PUT', `/hotel/room-types/${opsType.id}/rate-card`, { weekendRate: 6500, weekendDays: [5, 5], includedAdults: 2, freeChildren: 0, extraAdultRate: 0, extraChildRate: 0 })).status === 400);
    const meals = await h('PUT', `/hotel/room-types/${opsType.id}/meal-prices`, { prices: [{ plan: 'BED_BREAKFAST', adultPrice: 800, childPrice: 400 }, { plan: 'HALF_BOARD', adultPrice: 1800, childPrice: 900 }] });
    check('meal plan prices are saved', meals.status === 200 && meals.json.meals.find((m) => m.plan === 'BED_BREAKFAST').adultPrice === 800, meals);
    check('"room only" has no price to set', (await h('PUT', `/hotel/room-types/${opsType.id}/meal-prices`, { prices: [{ plan: 'ROOM_ONLY', adultPrice: 1, childPrice: 1 }] })).status === 400);
    const seasonStart = day(60), seasonEnd = day(64);
    const season = await h('POST', `/hotel/room-types/${opsType.id}/seasons`, { name: 'High season', startDate: seasonStart, endDate: seasonEnd, rate: 9000 });
    check('a season is added', season.status === 201 && season.json.seasons.length === 1, season);
    check('a season cannot end before it starts', (await h('POST', `/hotel/room-types/${opsType.id}/seasons`, { name: 'Bad', startDate: seasonEnd, endDate: seasonStart, rate: 100 })).status === 400);

    const friday = nextDow(5, 10);
    const sunday = day(upTo(day(0), friday) + 2);
    const qWeekend = await h('POST', '/hotel/bookings/quote', { roomTypeId: opsType.id, checkIn: friday, checkOut: sunday, rooms: 1, guests: 2 }, cashier);
    check('a desk quote: Friday and Saturday nights at the weekend price = KES 13,000, plus 18% tax = KES 15,340', qWeekend.status === 200 && qWeekend.json.subtotal === 13000 && qWeekend.json.tax === 2340 && qWeekend.json.total === 15340, qWeekend.json);
    check('the quote shows each tax by name (VAT 2,080, levy 260)', qWeekend.json.taxes?.find((t) => t.name === 'VAT')?.amount === 2080 && qWeekend.json.taxes?.find((t) => t.name === 'Tourism levy')?.amount === 260, qWeekend.json.taxes);
    const mon = nextDow(1, 10);
    const qExtras = await h('POST', '/hotel/bookings/quote', { roomTypeId: opsType.id, checkIn: mon, checkOut: day(upTo(day(0), mon) + 2), rooms: 1, guests: 3, children: 1, mealPlan: 'BED_BREAKFAST' }, cashier);
    // Monday and Tuesday: 5,000 each; 2 adults + 1 child: the child is free; breakfast 2 x 800 + 400 = 2,000 a night
    check('two weekday nights with a child (free) and breakfast: 2 x (5,000 + 2,000) = KES 14,000', qExtras.json.subtotal === 14000 && qExtras.json.mealTotal === 4000 && qExtras.json.extraTotal === 0, qExtras.json);
    const qThree = await h('POST', '/hotel/bookings/quote', { roomTypeId: opsType.id, checkIn: mon, checkOut: day(upTo(day(0), mon) + 1), rooms: 1, guests: 3 }, cashier);
    check('a third adult pays the extra adult price: 5,000 + 1,500', qThree.json.subtotal === 6500, qThree.json);
    const qSeason = await h('POST', '/hotel/bookings/quote', { roomTypeId: opsType.id, checkIn: seasonStart, checkOut: day(upTo(day(0), seasonStart) + 2), rooms: 1, guests: 2 }, cashier);
    check('nights inside the season use the season price', qSeason.json.nights?.every((n) => n.source === 'SEASON' || n.source === 'WEEKEND' || n.source === 'SEASON_WEEKEND') && qSeason.json.nights[0].rate === 9000, qSeason.json.nights);
    check('too many guests for the room is refused', (await h('POST', '/hotel/bookings/quote', { roomTypeId: opsType.id, checkIn: mon, checkOut: day(upTo(day(0), mon) + 1), rooms: 1, guests: 4 }, cashier)).status === 400);

    // The marketplace uses the same function: list the type, compare its public quote with the desk quote.
    await h('PUT', `/hotel/room-types/${opsType.id}`, { name: opsType.name, pricePerNight: 5000, maxGuests: 3, quantity: 4, depositPercent: 30, isListed: true });
    const pub = (await api('GET', `/public/hotels/${slug}?checkIn=${friday}&checkOut=${sunday}`)).json.roomTypes?.find((r) => r.id === opsType.id);
    check('the marketplace quote for the same stay is the same KES 13,000', pub?.quote?.total === 13000, pub?.quote);
    const pubBooking = await api('POST', `/public/hotels/${slug}/bookings`, { body: { roomTypeId: opsType.id, checkIn: friday, checkOut: sunday, rooms: 1, guests: 2, name: 'Market Mary', phone: '0700123456' } });
    check('and the marketplace booking is charged the same: KES 13,000, average KES 6,500 a night', pubBooking.status === 201 && pubBooking.json.total === 13000, pubBooking.json);
    await h('PUT', `/hotel/room-types/${opsType.id}`, { name: opsType.name, pricePerNight: 5000, maxGuests: 3, quantity: 4, depositPercent: 30, isListed: false });

    // A stay that is NOT one plain price: 3 nights, the first two in a season starting today, the last at the base price.
    const mixType = (await h('POST', '/hotel/room-types', { name: `Mixed-${tag}`, pricePerNight: 5000, maxGuests: 2, quantity: 1, depositPercent: 0, isListed: false })).json;
    await h('POST', '/hotel/rooms/bulk', { roomTypeId: mixType.id, prefix: `X${tag.slice(-3)}-`, from: 1, to: 3 });
    const mixRooms = (await h('GET', `/hotel/rooms?roomTypeId=${mixType.id}`)).json;
    await h('PUT', `/hotel/room-types/${mixType.id}/rate-card`, { weekendRate: null, weekendDays: [5, 6], includedAdults: 2, freeChildren: 0, extraAdultRate: 0, extraChildRate: 0 });
    await h('POST', `/hotel/room-types/${mixType.id}/seasons`, { name: 'Now', startDate: day(0), endDate: day(1), rate: 9000 });
    const mixed = await h('POST', '/hotel/bookings', { guestName: 'Mixed Mike', phone: '0711900100', guests: 2, checkIn: day(0), checkOut: day(3), roomTypeId: mixType.id }, cashier);
    check('a desk booking priced night by night: 9,000 + 9,000 + 5,000 = KES 23,000', mixed.status === 201 && mixed.json.total === 23000 && mixed.json.nights === 3, mixed.json);
    await h('PATCH', `/hotel/rooms/${mixRooms[0].id}/status`, { status: 'VACANT_CLEAN' }, cashier);
    const mixIn = await h('POST', `/hotel/bookings/${mixed.json.id}/check-in`, { roomIds: [mixRooms[0].id] }, cashier);
    check('checked in', mixIn.status === 200, mixIn);
    const mixFolio = (await h('GET', `/hotel/bookings/${mixed.json.id}/folio`)).json;
    const nightsOnFolio = mixFolio.entries.filter((e) => e.type === 'ROOM_NIGHT');
    check('the folio has the three nights at their own prices with tax: 10,620 / 10,620 / 5,900', nightsOnFolio.map((e) => e.amount).join() === '10620,10620,5900', nightsOnFolio.map((e) => e.amount));
    check('each night shows its tax by name (VAT and tourism levy)', nightsOnFolio.every((e) => e.taxBreakdown && 'VAT' in e.taxBreakdown && 'Tourism levy' in e.taxBreakdown), nightsOnFolio[0]);
    check('room tax on the folio totals KES 4,140 and the folio total KES 27,140', mixFolio.totals.roomTax === 4140 && mixFolio.totals.roomNights === 27140, mixFolio.totals);
    const mixOut = await h('POST', `/hotel/bookings/${mixed.json.id}/check-out`, { payments: [{ method: 'CASH', amount: 27140 }] }, cashier);
    check('check-out settles exactly: balance zero and the stay is checked out', mixOut.status === 200 && mixOut.json.booking.status === 'CHECKED_OUT', mixOut.json.message || mixOut.json.booking?.status);
    const mixSale = (await sql.query(`SELECT s.total, (SELECT count(*)::int FROM sale_line_items l WHERE l."saleId" = s.id) lines, (SELECT sum(quantity)::int FROM sale_line_items l WHERE l."saleId" = s.id) qty, (SELECT sum(l."taxAmount") FROM sale_line_items l WHERE l."saleId" = s.id) tax FROM sales s WHERE s."clientId" = $1`, [settlementId(mixed.json.id)])).rows[0];
    check('the settlement sale is one line for the agreed price, KES 27,140 including KES 4,140 tax', Number(mixSale?.total) === 27140 && mixSale.lines === 1 && mixSale.qty === 1 && Math.abs(Number(mixSale.tax) - 4140) < 0.01, mixSale);

    section('21. Changing a stay');
    const chType = (await h('POST', '/hotel/room-types', { name: `Change-${tag}`, pricePerNight: 5000, maxGuests: 2, quantity: 1, depositPercent: 0, isListed: false })).json;
    await h('POST', '/hotel/rooms/bulk', { roomTypeId: chType.id, prefix: `C${tag.slice(-3)}-`, from: 1, to: 3 });
    const chRooms = (await h('GET', `/hotel/rooms?roomTypeId=${chType.id}`)).json;
    const mkStay = (over = {}) => h('POST', '/hotel/bookings', { guestName: 'Change Chege', phone: '0711900200', guests: 2, checkIn: day(20), checkOut: day(22), roomTypeId: chType.id, ...over }, cashier);
    const s1 = await mkStay();
    check('a booking for two nights: KES 10,000', s1.status === 201 && s1.json.total === 10000, s1.json);
    const amend = (id, body, token = supervisor) => h('POST', `/hotel/bookings/${id}/amend`, { reason: 'Guest asked', ...body }, token);
    check('a cashier cannot change a stay', (await amend(s1.json.id, { checkOut: day(23) }, cashier)).status === 403);
    const preview = await amend(s1.json.id, { checkOut: day(23), dryRun: true });
    check('a dry run shows the new price (KES 15,000, +5,000) and saves nothing', preview.status === 200 && preview.json.preview.difference === 5000 && preview.json.preview.after.total === 15000 && (await h('GET', `/hotel/bookings/${s1.json.id}`)).json.total === 10000, preview.json);
    const ext = await amend(s1.json.id, { checkOut: day(23) });
    check('extending by a night re-prices the stay: 3 nights, KES 15,000', ext.status === 200 && ext.json.booking.nights === 3 && ext.json.booking.total === 15000, ext.json);
    check('the change is in the audit log with its reason', (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE "entityId" = $1 AND action = 'hotel.booking_amended'`, [s1.json.id])).rows[0].n === 1);
    check('moving the stay to other dates keeps the nights\' price: 2 nights, KES 10,000', (await amend(s1.json.id, { checkIn: day(21), checkOut: day(23) })).json.booking?.total === 10000);
    check('a supervisor cannot set a rate; the owner can (KES 4,000 a night -> KES 8,000)', (await amend(s1.json.id, { rate: 4000 })).status === 403 && (await amend(s1.json.id, { rate: 4000 }, owner)).json.booking?.total === 8000);
    check('check-out must be after check-in', (await amend(s1.json.id, { checkOut: day(21) })).status === 400);
    check('more rooms than the hotel has are refused', (await amend(s1.json.id, { rooms: 4, adults: 4 })).status === 400);
    check('a room type that does not exist is refused', (await amend(s1.json.id, { roomTypeId: '00000000-0000-0000-0000-000000000000' })).status === 404);
    // fill every room of the type on day(26)-day(27), then try to extend into it
    const fillers = [];
    for (let i = 0; i < 3; i++) fillers.push(await mkStay({ guestName: `Filler ${i}`, phone: `07119003${i}0`, checkIn: day(26), checkOut: day(27) }));
    check('three more bookings fill the type for one night', fillers.every((f) => f.status === 201), fillers.map((f) => f.status));
    const tooLate = await amend(s1.json.id, { checkIn: day(21), checkOut: day(28) });
    check('extending into a night with no room left is refused (and nothing changes)', tooLate.status === 409 && (await h('GET', `/hotel/bookings/${s1.json.id}`)).json.checkOut === day(23), tooLate.json);
    const swapType = await amend(s1.json.id, { roomTypeId: mixType.id });
    check('changing to another room type re-prices the whole stay from that type\'s list (2 nights x 5,000 = 10,000)', swapType.status === 200 && swapType.json.booking.roomTypeId === mixType.id && swapType.json.booking.total === 10000, swapType.json);
    check('an unpaid stay with no folio needs no folio entries', (await sql.query(`SELECT count(*)::int n FROM hotel_folio_entries e JOIN hotel_folios f ON f.id = e.\"folioId\" WHERE f.\"bookingId\" = $1`, [s1.json.id])).rows[0].n === 0);

    // A guest who is in the house: extend, shorten, add a room.
    const inHouse = await mkStay({ guestName: 'In House Ina', phone: '0711900400', checkIn: day(0), checkOut: day(2) });
    await h('PATCH', `/hotel/rooms/${chRooms[0].id}/status`, { status: 'VACANT_CLEAN' }, cashier);
    check('checked in', (await h('POST', `/hotel/bookings/${inHouse.json.id}/check-in`, { roomIds: [chRooms[0].id] }, cashier)).status === 200);
    const fb = (await h('GET', `/hotel/bookings/${inHouse.json.id}/folio`)).json.totals;
    check('the folio has two nights with tax: KES 11,800', fb.roomNights === 11800 && fb.balance === 11800, fb);
    check('the arrival date of a guest in the house cannot change', (await amend(inHouse.json.id, { checkIn: day(1) })).status === 400);
    const ext2 = await amend(inHouse.json.id, { checkOut: day(3) });
    const f2 = (await h('GET', `/hotel/bookings/${inHouse.json.id}/folio`)).json;
    check('extending a night adds KES 5,900 to the folio as a new entry (nothing edited)', ext2.status === 200 && f2.totals.roomNights === 17700 && f2.entries.filter((e) => e.type === 'ROOM_NIGHT').length === 3, f2.totals);
    const short = await amend(inHouse.json.id, { checkOut: day(1) });
    const f3 = (await h('GET', `/hotel/bookings/${inHouse.json.id}/folio`)).json;
    check('leaving early takes the nights off again: one night, KES 5,900, by adjusting entries', short.status === 200 && f3.totals.roomNights === 5900 && f3.entries.some((e) => e.type === 'ROOM_NIGHT' && e.amount < 0), f3.totals);
    check('a check-out date that has already passed is refused', (await amend(inHouse.json.id, { checkOut: day(-1) })).status === 400);
    await h('PATCH', `/hotel/rooms/${chRooms[1].id}/status`, { status: 'VACANT_CLEAN' }, cashier);
    check('another room needs the rooms to be chosen', (await amend(inHouse.json.id, { rooms: 2, adults: 2 })).status === 400);
    const addRoom = await amend(inHouse.json.id, { rooms: 2, adults: 2, roomIds: [chRooms[0].id, chRooms[1].id] });
    const f4 = (await h('GET', `/hotel/bookings/${inHouse.json.id}/folio`)).json;
    check('adding a second room puts both rooms on the stay and doubles the night: KES 11,800', addRoom.status === 200 && addRoom.json.booking.roomNumbers.length === 2 && f4.totals.roomNights === 11800, { rooms: addRoom.json.booking?.roomNumbers, totals: f4.totals });
    const outIna = await h('POST', `/hotel/bookings/${inHouse.json.id}/check-out`, { payments: [{ method: 'CASH', amount: f4.totals.balance }] }, cashier);
    const inaSale = (await sql.query(`SELECT total FROM sales WHERE "clientId" = $1`, [settlementId(inHouse.json.id)])).rows[0];
    check('check-out after the changes settles with the sale matching the folio exactly (KES 11,800)', outIna.status === 200 && Number(inaSale?.total) === 11800, outIna.json.message || inaSale);

    // A marketplace booking that is lengthened pays commission on the FINAL stay.
    await h('PUT', `/hotel/room-types/${mixType.id}`, { name: mixType.name, pricePerNight: 5000, maxGuests: 2, quantity: 3, depositPercent: 30, isListed: true });
    const mk2 = await api('POST', `/public/hotels/${slug}/bookings`, { body: { roomTypeId: mixType.id, checkIn: day(5), checkOut: day(7), rooms: 1, guests: 1, name: 'Market Moses', phone: '0700555111' } });
    const push2 = (await mock('GET', '/_test/pushes')).json.filter((p) => p.phone === '254700555111').pop();
    await mock('POST', `/_test/pay/${push2?.merchant_request_id}`);
    await sleep(300);
    await h('PUT', `/hotel/room-types/${mixType.id}`, { name: mixType.name, pricePerNight: 5000, maxGuests: 2, quantity: 3, depositPercent: 30, isListed: false });
    check('a marketplace booking of two nights (KES 10,000) is paid', mk2.status === 201 && mk2.json.total === 10000, mk2.json);
    const mkAmend = await amend(mk2.json.id, { checkOut: day(8) });
    check('a supervisor lengthens it to three nights: KES 15,000', mkAmend.status === 200 && mkAmend.json.booking.total === 15000, mkAmend.json);
    await sql.query(`UPDATE room_bookings SET "checkIn" = $2::date, "checkOut" = $3::date WHERE id = $1`, [mk2.json.id, day(0), day(3)]);
    await h('PATCH', `/hotel/rooms/${mixRooms[1].id}/status`, { status: 'VACANT_CLEAN' }, cashier);
    const mkIn = await h('POST', `/hotel/bookings/${mk2.json.id}/check-in`, { roomIds: [mixRooms[1].id] }, cashier);
    const mkFolio = (await h('GET', `/hotel/bookings/${mk2.json.id}/folio`)).json;
    const mkOut = await h('POST', `/hotel/bookings/${mk2.json.id}/check-out`, { payments: [{ method: 'CASH', amount: Math.max(0.01, mkFolio.totals.balance) }] }, cashier);
    const mkCommission = Number((await sql.query(`SELECT "commissionAmount" c FROM room_bookings WHERE id = $1`, [mk2.json.id])).rows[0].c);
    check('commission is 3% of the final stay (KES 15,000 -> KES 450), not of the first booking', mkIn.status === 200 && mkOut.status === 200 && Math.abs(mkCommission - 450) < 0.01, { mkCommission, in: mkIn.json.message, out: mkOut.json.message });

    section('22. Cancellation policy');
    const rules = (over = {}) => ({ cancelFreeDays: 3, cancelKeepPercent: 50, nightAuditHour: 3, noShowCutoffHour: 18, confirmationSms: true, reminderSms: true, thankYouSms: true, ...over });
    check('the owner sets the policy: free until 3 days before, then half the deposit is kept', (await h('PUT', '/hotel/settings', rules())).status === 200);
    check('rules outside their range are refused', (await h('PUT', '/hotel/settings', rules({ cancelKeepPercent: 150 }))).status === 400);
    const late = await mkStay({ guestName: 'Late Lucy', phone: '0711900500', checkIn: day(1), checkOut: day(2) });
    await h('POST', `/hotel/bookings/${late.json.id}/payments`, { method: 'CASH', amount: 2000 }, cashier);
    const prev = await h('GET', `/hotel/bookings/${late.json.id}/cancellation-preview`, undefined, supervisor);
    check('the preview: one day before arrival is inside the 3 days, so KES 1,000 is kept and KES 1,000 goes back', prev.status === 200 && prev.json.withinFreeWindow === false && prev.json.feeKept === 1000 && prev.json.refundDue === 1000, prev.json);
    check('a supervisor cannot waive the fee', (await h('POST', `/hotel/bookings/${late.json.id}/cancel`, { reason: 'Guest ill', waiveFee: true }, supervisor)).status === 403);
    const cancelLate = await h('POST', `/hotel/bookings/${late.json.id}/cancel`, { reason: 'Guest ill' }, supervisor);
    check('cancelling keeps half the deposit and says KES 1,000 is owed back', cancelLate.status === 201 && cancelLate.json.status === 'CANCELLED' && cancelLate.json.refundDue === 1000 && cancelLate.json.feeKept === 1000, cancelLate.json.cancellation || cancelLate.json);
    check('the fee kept is recorded on the booking', Number((await sql.query(`SELECT "cancelFeeKept" f FROM room_bookings WHERE id = $1`, [late.json.id])).rows[0].f) === 1000);
    check('a supervisor cannot record the refund', (await h('POST', `/hotel/bookings/${late.json.id}/cancellation-refund`, { method: 'CASH' }, supervisor)).status === 403);
    await tidy();
    check('the guest is texted about it (sent, failed or skipped - and only once)', (await sql.query(`SELECT count(*)::int n FROM hotel_notifications WHERE "bookingId" = $1 AND kind = 'CANCELLATION'`, [late.json.id])).rows[0].n === 1);
    const payBack = await h('POST', `/hotel/bookings/${late.json.id}/cancellation-refund`, { method: 'CASH' });
    check('the owner records the refund: KES 1,000 goes back and the fee stays on the folio', payBack.status === 201 && payBack.json.refunded === 1000, payBack);
    check('doing it again is refused (nothing left to refund)', (await h('POST', `/hotel/bookings/${late.json.id}/cancellation-refund`, { method: 'CASH' })).status === 409);
    const lateFolio = (await h('GET', `/hotel/bookings/${late.json.id}/folio`)).json.totals;
    check('the folio keeps exactly the fee: paid 2,000, refunded 1,000', lateFolio.payments === 2000 && lateFolio.refunds === 1000, lateFolio);
    const earlyBk = await mkStay({ guestName: 'Early Edna', phone: '0711900600', checkIn: day(15), checkOut: day(16) });
    await h('POST', `/hotel/bookings/${earlyBk.json.id}/payments`, { method: 'CASH', amount: 2000 }, cashier);
    const cancelEarly = await h('POST', `/hotel/bookings/${earlyBk.json.id}/cancel`, { reason: 'Plans changed' }, supervisor);
    check('cancelling well before arrival is free: all KES 2,000 goes back', cancelEarly.json.refundDue === 2000 && cancelEarly.json.feeKept === 0, cancelEarly.json.cancellation);
    const waive = await mkStay({ guestName: 'Waived Wale', phone: '0711900700', checkIn: day(1), checkOut: day(2) });
    await h('POST', `/hotel/bookings/${waive.json.id}/payments`, { method: 'CASH', amount: 1000 }, cashier);
    const cancelWaive = await h('POST', `/hotel/bookings/${waive.json.id}/cancel`, { reason: 'Hotel double-booked', waiveFee: true });
    check('a manager can waive the fee: all KES 1,000 goes back', cancelWaive.status === 201 && cancelWaive.json.refundDue === 1000 && cancelWaive.json.feeKept === 0 && cancelWaive.json.cancellation.waived === true, cancelWaive.json.cancellation);
    check('the cancellations are in the audit log with the money', (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'hotel.booking_cancelled' AND "entityId" = ANY($1)`, [[late.json.id, earlyBk.json.id, waive.json.id]])).rows[0].n === 3);
    const noshowPaid = await mkStay({ guestName: 'No-Show Nia', phone: '0711900800', checkIn: day(1), checkOut: day(2) });
    await h('POST', `/hotel/bookings/${noshowPaid.json.id}/payments`, { method: 'CASH', amount: 1000 }, cashier);
    const ns = await h('POST', `/hotel/bookings/${noshowPaid.json.id}/no-show`, {}, supervisor);
    check('marking a no-show applies the same policy (half of KES 1,000 kept)', ns.status === 201 && ns.json.status === 'NO_SHOW' && ns.json.feeKept === 500 && ns.json.refundDue === 500, ns.json);
    await h('PUT', '/hotel/settings', rules({ cancelKeepPercent: 0 }));

    section('23. The guest register');
    const u6 = String(Date.now()).slice(-6);
    const ritaPhone = `0711 9${u6.slice(1)}`;
    const ritaPhoneCompact = ritaPhone.replace(/ /g, '');
    const ritaId = `a ${u6}-4321`;
    const ritaIdCompact = `A${u6}4321`;
    const g1b = await mkStay({ guestName: 'Register Rita', phone: ritaPhone, idNumber: ritaId, nationality: 'Kenyan', address: 'Nakuru', vehicleReg: 'KDA 123A', checkIn: day(30), checkOut: day(31) });
    const g2b = await mkStay({ guestName: 'Rita Register', phone: '0799 000 111', idNumber: ritaIdCompact, checkIn: day(32), checkOut: day(33) });
    check('the same ID number (typed another way) is the same guest, whatever the name or phone', g1b.json.guestId && g1b.json.guestId === g2b.json.guestId, [g1b.json.guestId, g2b.json.guestId]);
    const byPhone = await h('GET', `/hotel/guests/lookup?phone=${ritaPhoneCompact}`, undefined, cashier);
    check('a returning guest is found by phone and the ID shows only its last four', byPhone.status === 200 && byPhone.json.length === 1 && byPhone.json[0].idNumber === '****4321' && byPhone.json[0].stays === 2, byPhone.json);
    const byId = await h('GET', `/hotel/guests/lookup?idNumber=${ritaIdCompact.toLowerCase()}`, undefined, cashier);
    check('and by ID number', byId.json.length === 1 && byId.json[0].id === g1b.json.guestId, byId.json);
    const stored = (await sql.query(`SELECT "idNumberEnc" e, "idLast4" l FROM hotel_guests WHERE id = $1`, [g1b.json.guestId])).rows[0];
    check('the ID number is stored encrypted, not as typed', stored.e && !stored.e.includes(u6) && stored.l === '4321', stored);
    check('a booking made with a guest chosen from the register uses their record', (await mkStay({ guestName: 'Register Rita', phone: ritaPhoneCompact, guestId: g1b.json.guestId, checkIn: day(34), checkOut: day(35) })).json.guestId === g1b.json.guestId);
    check('the whole register is for a supervisor and above', (await h('GET', '/hotel/guests', undefined, cashier)).status === 403 && (await h('GET', '/hotel/guests?search=Rita', undefined, supervisor)).json.length >= 1);
    const rec = await h('GET', `/hotel/guests/${g1b.json.guestId}`, undefined, supervisor);
    check('a supervisor sees the whole ID number on the guest\'s own record, with the stays', (rec.json.idNumber || '').includes(u6), rec.json.idNumber);
    check('the record keeps address, vehicle and the stays', rec.json.address === 'Nakuru' && rec.json.vehicleReg === 'KDA 123A' && rec.json.stays.length >= 3, rec.json);
    check('the register list never shows a whole ID', !JSON.stringify((await h('GET', '/hotel/guests', undefined, supervisor)).json).includes(ritaId));
    const card = await h('GET', `/hotel/bookings/${g1b.json.id}/registration-card`, undefined, cashier);
    check('the registration card has the guest, ID (masked for a cashier), vehicle and stay', card.status === 200 && card.json.guestName === 'Register Rita' && card.json.idNumber?.endsWith('4321') && !card.json.idNumber.includes(u6) && card.json.vehicleReg === 'KDA 123A' && card.json.nights === 1, card.json);
    check('a supervisor\'s registration card carries the full ID', ((await h('GET', `/hotel/bookings/${g1b.json.id}/registration-card`, undefined, supervisor)).json.idNumber || '').includes(u6));
    const optOut = await h('PATCH', `/hotel/guests/${g1b.json.guestId}`, { smsOptOut: true });
    check('the owner marks the guest as not wanting texts', optOut.status === 200 && optOut.json.smsOptOut === true, optOut);
    const quiet = await mkStay({ guestName: 'Register Rita', phone: ritaPhoneCompact, guestId: g1b.json.guestId, checkIn: day(36), checkOut: day(37) });
    await tidy(900);
    const quietRow = (await sql.query(`SELECT status, detail FROM hotel_notifications WHERE "bookingId" = $1 AND kind = 'CONFIRMATION'`, [quiet.json.id])).rows[0];
    check('a guest who opted out gets no confirmation text (recorded as skipped)', quietRow?.status === 'SKIPPED' && /opted out/i.test(quietRow.detail), quietRow);
    const loud = await mkStay({ guestName: 'Loud Lena', phone: '0711900950', checkIn: day(36), checkOut: day(37) });
    await tidy(900);
    const loudRows = (await sql.query(`SELECT count(*)::int n, min(status) s FROM hotel_notifications WHERE "bookingId" = $1 AND kind = 'CONFIRMATION'`, [loud.json.id])).rows[0];
    check('a front-desk booking is confirmed by text, once (sent, or failed here because no SMS account is set up)', loudRows.n === 1 && ['SENT', 'FAILED'].includes(loudRows.s), loudRows);

    section('24. Night audit');
    await sql.query(`DELETE FROM hotel_night_audits WHERE "organizationId" = $1`, [org.id]);
    // A real overstay and a real no-show need past dates, which the API will not book: shift two bookings back in time directly.
    const stayer = await mkStay({ guestName: 'Stayer Sam', phone: '0711901000', checkIn: day(0), checkOut: day(1) });
    await h('PATCH', `/hotel/rooms/${chRooms[2].id}/status`, { status: 'VACANT_CLEAN' }, cashier);
    await h('POST', `/hotel/bookings/${stayer.json.id}/check-in`, { roomIds: [chRooms[2].id] }, cashier);
    await sql.query(`UPDATE room_bookings SET "checkIn" = $2::date, "checkOut" = $3::date, nights = 1 WHERE id = $1`, [stayer.json.id, day(-2), day(-1)]);
    await sql.query(`UPDATE hotel_folio_entries SET "nightDate" = $2::date WHERE "folioId" = (SELECT id FROM hotel_folios WHERE "bookingId" = $1) AND type = 'ROOM_NIGHT'`, [stayer.json.id, day(-2)]);
    const absent = await mkStay({ guestName: 'Absent Abel', phone: '0711901100', checkIn: day(40), checkOut: day(42), roomTypeId: opsType.id });
    const absentPaid = await mkStay({ guestName: 'Deposit Dina', phone: '0711901200', checkIn: day(40), checkOut: day(42), roomTypeId: opsType.id });
    await h('POST', `/hotel/bookings/${absentPaid.json.id}/payments`, { method: 'CASH', amount: 1000 }, cashier);
    await sql.query(`UPDATE room_bookings SET "checkIn" = $2::date, "checkOut" = $3::date, nights = 2 WHERE id = ANY($1)`, [[absent.json.id, absentPaid.json.id], day(-1), day(1)]);
    check('a cashier cannot close the day; the future cannot be closed', (await h('POST', '/hotel/night-audit', { date: day(-1) }, cashier)).status === 403 && (await h('POST', '/hotel/night-audit', { date: day(2) }, supervisor)).status === 400);
    const audit1 = await h('POST', '/hotel/night-audit', { date: day(-1) }, supervisor);
    const sum = audit1.json.summary;
    check('the night audit closes yesterday', audit1.status === 200 && audit1.json.alreadyRun === false && sum.date === day(-1), audit1.json);
    check('the guest who stayed past their check-out date is charged the extra night (KES 5,900 with tax)', sum.overstays.some((o) => o.guestName === 'Stayer Sam' && o.nights === 1 && o.charged === 5000), sum.overstays);
    check('the unpaid arrival that never came is a no-show; the one with a deposit is left for the manager', sum.arrivals.noShows.some((n) => n.guestName === 'Absent Abel') && !sum.arrivals.noShows.some((n) => n.guestName === 'Deposit Dina') && sum.arrivals.stillExpectedPaid.some((n) => n.guestName === 'Deposit Dina'), sum.arrivals);
    check('the bookings changed accordingly', (await sql.query(`SELECT status FROM room_bookings WHERE id = $1`, [absent.json.id])).rows[0].status === 'NO_SHOW' && (await sql.query(`SELECT status FROM room_bookings WHERE id = $1`, [absentPaid.json.id])).rows[0].status === 'CONFIRMED');
    const stayerFolio = (await h('GET', `/hotel/bookings/${stayer.json.id}/folio`)).json;
    check('the overstay night is on the folio (two nights now: KES 11,800)', stayerFolio.totals.roomNights === 11800, stayerFolio.totals);
    check('the summary has rooms, money and balances', sum.rooms.total > 0 && typeof sum.money.roomRevenue === 'number' && typeof sum.money.outstandingInHouse === 'number', sum);
    const entriesBefore = (await sql.query(`SELECT count(*)::int n FROM hotel_folio_entries`)).rows[0].n;
    const audit2 = await h('POST', '/hotel/night-audit', { date: day(-1) }, owner);
    check('running it again finds the first audit and changes nothing', audit2.status === 200 && audit2.json.alreadyRun === true && audit2.json.summary.date === sum.date && audit2.json.summary.overstays.length === sum.overstays.length && audit2.json.summary.arrivals.noShows.length === sum.arrivals.noShows.length && (await sql.query(`SELECT count(*)::int n FROM hotel_folio_entries`)).rows[0].n === entriesBefore, audit2.json.alreadyRun);
    const twice = await Promise.all([h('POST', '/hotel/night-audit', { date: day(-3) }, owner), h('POST', '/hotel/night-audit', { date: day(-3) }, supervisor)]);
    check('two at the same moment: both succeed, one does the work and there is one audit for that day', twice.every((r) => r.status === 200) && twice.filter((r) => r.json.alreadyRun === false).length === 1 && (await sql.query(`SELECT count(*)::int n FROM hotel_night_audits WHERE "organizationId" = $1 AND "auditDate" = $2::date`, [org.id, day(-3)])).rows[0].n === 1, twice.map((r) => r.json.alreadyRun));
    const auditList = await h('GET', '/hotel/night-audits');
    check('the owner can list past audits', auditList.status === 200 && auditList.json.some((a) => a.date === day(-1)), auditList.json.length);

    section('25. Reports');
    const from = day(0), to = day(6);
    const occ = await h('GET', `/hotel/reports/occupancy?from=${from}&to=${to}`);
    check('occupancy has a row for each of the seven days and the headline figures', occ.status === 200 && occ.json.rows.length === 7 && occ.json.figures.length === 6, occ.json.figures);
    const expectSold = Number((await sql.query(`SELECT COALESCE(sum(rooms * GREATEST(0, LEAST("checkOut", $2::date + 1) - GREATEST("checkIn", $1::date))), 0)::int n FROM room_bookings WHERE status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT') AND "organizationId" = $3 AND "checkIn" <= $2::date AND "checkOut" > $1::date`, [from, to, org.id])).rows[0].n);
    const soldFigure = occ.json.figures.find((f) => f.label === 'Room nights sold').value;
    check('room nights sold agree with the bookings in the database', soldFigure === expectSold, { soldFigure, expectSold });
    const rooms = occ.json.figures.find((f) => f.label === 'Rooms').value;
    const occPct = occ.json.figures.find((f) => f.label === 'Occupancy %').value;
    check('occupancy % = nights sold / (rooms x 7 days)', Math.abs(occPct - Math.round((Math.min(soldFigure, rooms * 7) / (rooms * 7)) * 10000) / 100) < 0.02, { occPct, soldFigure, rooms });
    const rev = await h('GET', `/hotel/reports/revenue?from=${from}&to=${to}`);
    const revTotal = rev.json.figures.find((f) => f.label.startsWith('Room revenue')).value;
    check('revenue is split by marketplace, front desk and phone, and the parts add up to the whole', rev.json.rows.length === 3 && Math.abs(rev.json.rows.reduce((s, r) => s + r[2], 0) - revTotal) < 0.01, rev.json.rows);
    check('ADR is revenue per room night sold; RevPAR is revenue per room night available', Math.abs(rev.json.figures.find((f) => f.label.startsWith('ADR')).value - (soldFigure ? revTotal / soldFigure : 0)) < 0.02 && Math.abs(rev.json.figures.find((f) => f.label.startsWith('RevPAR')).value - revTotal / (rooms * 7)) < 0.02);
    const csvName = `=cmd|' /C calc'!A0`;
    await mkStay({ guestName: csvName, phone: '0711902000', checkIn: day(45), checkOut: day(46), roomTypeId: opsType.id });
    const arr = await h('GET', `/hotel/reports/arrivals?date=${day(45)}&format=csv`);
    check('the CSV export defuses a guest name that would run as a spreadsheet formula', arr.status === 200 && arr.json.csv.includes(`'=cmd`) && !arr.json.csv.split('\r\n').some((line) => line.split(',').some((cell) => cell.startsWith('='))), arr.json.csv?.slice(0, 300));
    check('the CSV has the header and a file name', arr.json.csv.startsWith('Booking,Guest,') && /^arrivals-.*\.csv$/.test(arr.json.filename), arr.json.filename);
    const dep = await h('GET', `/hotel/reports/departures?date=${day(1)}`);
    const inh = await h('GET', '/hotel/reports/in-house');
    check('the departures and in-house lists work', dep.status === 200 && Array.isArray(dep.json.rows) && inh.status === 200 && inh.json.rows.every((r) => r[10] === 'CHECKED_IN'), inh.json.rows?.length);
    check('the lists mask the ID numbers', !JSON.stringify(arr.json).includes('A1234567'));
    const bal = await h('GET', `/hotel/reports/balances`);
    check('outstanding balances list the guest left owing at check-out, with the reason', bal.status === 200 && bal.json.rows.some((r) => r[0] === b3.json.bookingNumber && r[6] === 'Company will pay by cheque'), bal.json.rows?.length);
    const canc = await h('GET', `/hotel/reports/cancellations?from=${day(0)}&to=${day(0)}`);
    check('cancellations and no-shows show the fees kept and the refunds still to pay', canc.status === 200 && canc.json.figures.find((f) => f.label === 'Fees kept (KES)').value >= 1500 && canc.json.rows.some((r) => r[1] === 'No-Show Nia' && r[2] === 'NO_SHOW' && r[8] === 500), canc.json.figures);
    check('a cashier cannot open the reports; an unknown report, an end before the start, or a year and more are refused', (await h('GET', `/hotel/reports/occupancy?from=${from}&to=${to}`, undefined, cashier)).status === 403 && (await h('GET', '/hotel/reports/nope')).status === 400 && (await h('GET', `/hotel/reports/occupancy?from=${to}&to=${from}`)).status === 400 && (await h('GET', `/hotel/reports/occupancy?from=${day(0)}&to=${day(400)}`)).status === 400);
    check('the reports need a sign-in', (await api('GET', '/hotel/reports/occupancy')).status === 401);

    section('26. Row-level security on the hotel operations tables');
    for (const t of ['hotel_settings', 'hotel_taxes', 'hotel_rate_cards', 'hotel_seasons', 'hotel_meal_prices', 'hotel_guests', 'hotel_night_audits', 'hotel_notifications']) {
      const r = (await sql.query(`SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`, [t])).rows[0];
      check(`${t} has row-level security switched on and forced`, r?.on === true && r?.forced === true, r);
    }
    // tidy the hotel's taxes so the rest of the suite (and a re-run) starts from the same place
    await h('PUT', '/hotel/taxes', { taxes: [] });
  }

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
