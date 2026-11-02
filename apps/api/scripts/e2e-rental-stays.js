// End-to-end check of short stays (ZARODA RENTALS) against a LOCAL throwaway API.
//   node scripts/e2e-rental-stays.js [http://localhost:3001]
const BASE = process.argv[2] || 'http://localhost:3001';
let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, type: res.headers.get('content-type') };
}

const login = async (email) => (await call('POST', '/auth/login', null, { email, password: 'password123' })).body.accessToken;

async function newLandlord(label) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `stays-${label}-${suffix}@example.test`;
  const reg = await call('POST', '/auth/register', null, {
    organizationName: `Stays ${label} ${suffix}`,
    industryType: 'RENTAL',
    ownerFullName: 'Test Owner',
    ownerEmail: email,
    ownerPassword: 'password123',
    branchName: 'Main',
  });
  if (reg.status >= 300) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  return { token: await login(email), suffix };
}

const DAY = 86400000;
const nairobi = () => new Date(Date.now() + 3 * 3600000);
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(nairobi().getTime() + n * DAY));

(async () => {
  const { token: A, suffix } = await newLandlord('A');
  const { token: B } = await newLandlord('B');

  const p1 = (await call('POST', '/rental/properties', A, { name: 'Kilimani Stays' })).body;
  const p2 = (await call('POST', '/rental/properties', A, { name: 'Westlands Court' })).body;
  const u1 = (await call('POST', '/rental/units', A, { propertyId: p1.id, label: 'A4', monthlyRent: 30000 })).body;
  const u2 = (await call('POST', '/rental/units', A, { propertyId: p2.id, label: 'W1', monthlyRent: 30000 })).body;
  const uLeased = (await call('POST', '/rental/units', A, { propertyId: p1.id, label: 'A5', monthlyRent: 20000 })).body;
  await call('POST', '/rental/tenants', A, { name: 'Long Tenant', unitId: uLeased.id, startDate: inDays(-10), dueDay: 5 });

  // -- Plan: short stays need Starter or above --
  const unitBody = { nightlyRate: 5000, weekendRate: 7000, cleaningFee: 1500, minNights: 2, maxGuests: 3, directions: 'Gate 2, block A, 4th floor', doorCode: '4821', cleanerName: 'Mama Wanjiru', cleanerPhone: '0711000111' };
  const onBure = await call('PUT', `/rental/stays/units/${u1.id}`, A, unitBody);
  check('Bure plan is asked to upgrade', onBure.status === 402, onBure);
  const up = await call('POST', '/rental/plan', A, { plan: 'starter' });
  check('moved to Starter', up.status < 300, up.body);

  // -- Units --
  const s1 = await call('PUT', `/rental/stays/units/${u1.id}`, A, unitBody);
  check('unit set up for short stays', s1.status === 200, s1.body);
  check('a unit on a lease cannot be let by the night', (await call('PUT', `/rental/stays/units/${uLeased.id}`, A, unitBody)).status === 409);
  await call('PUT', `/rental/stays/units/${u2.id}`, A, { nightlyRate: 4000 });
  const units = (await call('GET', '/rental/stays/units', A)).body;
  const su1 = units.find((u) => u.unitId === u1.id).shortStay;
  check('unit settings come back, door code readable', su1 && su1.doorCode === '4821' && su1.weekendRate === 7000 && su1.cleaningFee === 1500, su1);
  check('calendar export links are given', !!su1.calendarUrl && su1.calendarUrls.AIRBNB.includes('?for=AIRBNB'), su1);
  const leaseOnStay = await call('POST', '/rental/leases', A, { unitId: u1.id, tenantId: (await call('GET', '/rental/tenants', A)).body[0].id, startDate: inDays(0) });
  check('a short-stay unit cannot take a lease', leaseOnStay.status === 409, leaseOnStay.body);
  check('landlord B cannot see A\'s short-stay unit', (await call('PUT', `/rental/stays/units/${u1.id}`, B, unitBody)).status === 404);

  // -- Quote and booking --
  const ci = inDays(3);
  const co = inDays(6);
  const quote = (await call('GET', `/rental/stays/quote?unitId=${u1.id}&checkIn=${ci}&checkOut=${co}`, A)).body;
  check('quote prices 3 nights plus cleaning', quote.nights === 3 && quote.cleaningFee === 1500 && quote.total === quote.accommodation + 1500 && quote.accommodation >= 15000 && quote.accommodation <= 21000 && quote.clash === null, quote);
  check('a one-night direct booking is refused (minimum 2)', (await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Short', checkIn: ci, checkOut: inDays(4) })).status === 400);
  check('too many guests refused', (await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Crowd', guests: 5, checkIn: ci, checkOut: co })).status === 400);
  const st1 = await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Achieng Otieno', guestPhone: '0722000222', guestEmail: 'achieng@example.test', guests: 2, checkIn: ci, checkOut: co });
  check('direct booking made', st1.status === 201 && /^ST-\d{4}$/.test(st1.body.code) && st1.body.total === quote.total && st1.body.balance === quote.total, st1.body);
  const stay1 = st1.body;
  const clash = await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Clash', checkIn: inDays(5), checkOut: inDays(8) });
  check('overlapping dates refused, naming the booking', clash.status === 409 && String(clash.body.message).includes(stay1.code), clash.body);
  const backToBack = await call('POST', '/rental/stays', A, { unitId: u1.id, source: 'AIRBNB', externalRef: 'HMABC123', guestName: 'Airbnb Guest', checkIn: co, checkOut: inDays(7), accommodation: 6000, cleaningFee: 0, channelFee: 180 });
  check('arrival on the check-out day is fine; Airbnb price and fee taken as typed', backToBack.status === 201 && backToBack.body.total === 6000 && backToBack.body.balance === 5820, backToBack.body);

  // -- Payments --
  const pay1 = await call('POST', `/rental/stays/${stay1.id}/payments`, A, { amount: 5000, method: 'MPESA', reference: `QK${suffix}1` });
  check('deposit recorded with a receipt', pay1.status === 201 && pay1.body.paid === 5000 && /^RS-/.test(pay1.body.payments[0].receiptNumber), pay1.body);
  check('the same M-Pesa code twice is refused', (await call('POST', `/rental/stays/${stay1.id}/payments`, A, { amount: 100, method: 'MPESA', reference: `qk${suffix}1` })).status === 409);
  check('more than the balance is refused', (await call('POST', `/rental/stays/${stay1.id}/payments`, A, { amount: 999999, method: 'CASH' })).status === 400);
  check('a refund larger than paid is refused', (await call('POST', `/rental/stays/${stay1.id}/payments`, A, { kind: 'REFUND', amount: 6000, method: 'CASH' })).status === 400);
  const payChan = await call('POST', `/rental/stays/${backToBack.body.id}/payments`, A, { amount: 5820, method: 'CHANNEL', note: 'Airbnb payout' });
  check('Airbnb payout clears the booking', payChan.body.balance === 0, payChan.body);
  const voided = await call('POST', `/rental/stays/${stay1.id}/payments/${pay1.body.payments[0].id}/void`, A, { reason: 'Wrong booking' });
  check('a payment can be voided and the balance goes back', voided.body.paid === 0 && voided.body.payments[0].voided === true, voided.body);
  await call('POST', `/rental/stays/${stay1.id}/payments`, A, { amount: 5000, method: 'CASH' });

  // -- Changes --
  const moved = await call('PATCH', `/rental/stays/${stay1.id}`, A, { checkOut: co, guests: 3 });
  check('a change that keeps the dates keeps the price', moved.status === 200 && moved.body.total === quote.total && moved.body.guests === 3, moved.body);
  check('moving into the Airbnb booking is refused', (await call('PATCH', `/rental/stays/${stay1.id}`, A, { checkOut: inDays(7) })).status === 409);

  // -- Blocks and calendar --
  const blk = await call('POST', '/rental/stays/blocks', A, { unitId: u1.id, startDate: inDays(10), endDate: inDays(12), summary: 'Owner staying' });
  check('dates blocked by hand', blk.status === 201, blk.body);
  check('a booking on blocked dates is refused', (await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Blocked', checkIn: inDays(10), checkOut: inDays(13) })).status === 409);
  const cal = (await call('GET', `/rental/stays/calendar?from=${inDays(0)}&days=14`, A)).body;
  const calU1 = cal.units.find((u) => u.unitId === u1.id);
  check('calendar shows both bookings and the block', calU1.stays.length === 2 && calU1.blocks.length === 1 && calU1.cleaningsDue.length === 2, calU1);
  const calDays = await call('GET', '/rental/stays/calendar?days=3', A);
  check('calendar range is checked', calDays.status === 400);

  // -- Calendar feeds --
  check('a calendar link from another site is refused', (await call('POST', `/rental/stays/units/${u1.id}/feeds`, A, { source: 'OTHER', url: 'https://169.254.169.254/latest/meta-data' })).status === 400);
  check('a plain http link is refused', (await call('POST', `/rental/stays/units/${u1.id}/feeds`, A, { source: 'AIRBNB', url: 'http://www.airbnb.com/calendar/ical/1.ics' })).status === 400);
  const feed = await call('POST', `/rental/stays/units/${u1.id}/feeds`, A, { source: 'AIRBNB', url: `https://www.airbnb.com/calendar/ical/e2e-${suffix}.ics?s=x` });
  check('an Airbnb calendar can be linked (read result reported)', feed.status === 201 && typeof feed.body.synced === 'boolean', feed.body);
  check('the same link twice is refused', (await call('POST', `/rental/stays/units/${u1.id}/feeds`, A, { source: 'AIRBNB', url: `https://www.airbnb.com/calendar/ical/e2e-${suffix}.ics?s=x` })).status === 409);
  const feedRow = (await call('GET', '/rental/stays/units', A)).body.find((u) => u.unitId === u1.id).shortStay.feeds[0];
  check('the linked calendar is listed', !!feedRow && feedRow.source === 'AIRBNB', feedRow);
  check('read now is limited to once a minute', (await call('POST', `/rental/stays/feeds/${feedRow.id}/sync`, A)).status === 400);

  const path = su1.calendarUrl.slice(su1.calendarUrl.indexOf('/public/'));
  const ics = await call('GET', path, null);
  check('export calendar is a calendar file', ics.status === 200 && String(ics.type).includes('text/calendar') && String(ics.body).includes('BEGIN:VCALENDAR'), ics.status);
  check('export has both bookings and the block, no guest names', (String(ics.body).match(/BEGIN:VEVENT/g) || []).length === 3 && !String(ics.body).includes('Achieng'), ics.body);
  const icsAirbnb = await call('GET', `${path}?for=AIRBNB`, null);
  check("Airbnb's copy leaves out the Airbnb booking", (String(icsAirbnb.body).match(/BEGIN:VEVENT/g) || []).length === 2, icsAirbnb.body);
  check('a wrong calendar secret is refused', (await call('GET', path.replace(/\/[^/]+\.ics$/, '/wrongtoken.ics'), null)).status === 404);
  await call('POST', `/rental/stays/units/${u1.id}/new-calendar-link`, A);
  check('a new calendar link cuts off the old one', (await call('GET', path, null)).status === 404);

  // -- Caretaker --
  const ctEmail = `stays-ct-${suffix}@example.test`;
  const ct = await call('POST', '/org-users', A, { email: ctEmail, fullName: 'Caretaker Kim', password: 'password123', role: 'CARETAKER' });
  check('caretaker added', ct.status === 201, ct.body);
  const ctList = (await call('GET', '/rental/caretakers', A)).body;
  await call('PUT', `/rental/caretakers/${ctList[0].id}/properties`, A, { propertyIds: [p2.id] });
  const C = await login(ctEmail);
  const ctStays = (await call('GET', '/rental/stays?view=upcoming', C)).body;
  check("caretaker does not see another property's bookings", Array.isArray(ctStays) && ctStays.length === 0, ctStays);
  check("caretaker cannot open that booking", (await call('GET', `/rental/stays/${stay1.id}`, C)).status === 404);
  check('caretaker cannot change unit prices', (await call('PUT', `/rental/stays/units/${u2.id}`, C, { nightlyRate: 1 })).status === 403);
  check('caretaker cannot see owner statements', (await call('GET', `/rental/stays/statements?month=${inDays(0).slice(0, 7)}`, C)).status === 403);
  const ctStay = await call('POST', '/rental/stays', C, { unitId: u2.id, guestName: 'Walk In', checkIn: inDays(0), checkOut: inDays(2) });
  check('caretaker books a guest on their property', ctStay.status === 201, ctStay.body);
  check('caretaker cannot book on another property', (await call('POST', '/rental/stays', C, { unitId: u1.id, guestName: 'No', checkIn: inDays(20), checkOut: inDays(22) })).status === 404);

  // -- Check-in, check-out, cleaning --
  check('cannot check in before the arrival day', (await call('POST', `/rental/stays/${stay1.id}/check-in`, A)).status === 400);
  check('cannot check out before checking in', (await call('POST', `/rental/stays/${ctStay.body.id}/check-out`, C)).status === 400);
  const inn = await call('POST', `/rental/stays/${ctStay.body.id}/check-in`, C);
  check('caretaker checks the guest in', inn.status === 200 && inn.body.status === 'CHECKED_IN', inn.body);
  check('a checked-in guest cannot be cancelled', (await call('POST', `/rental/stays/${ctStay.body.id}/cancel`, A, { reason: 'test' })).status === 400);
  const out = await call('POST', `/rental/stays/${ctStay.body.id}/check-out`, C);
  check('early check-out', out.status === 200 && out.body.status === 'CHECKED_OUT', out.body);
  const cl = (await call('GET', '/rental/stays/cleanings', C)).body;
  check('the cleaning is due today for the caretaker', cl.length === 1 && cl[0].dueDate === inDays(0) && cl[0].stay.guestLeft === true, cl);
  const done = await call('POST', `/rental/stays/cleanings/${cl[0].id}/done`, C, { notes: 'Linen changed' });
  check('caretaker marks it cleaned', done.status === 200 && done.body.status === 'DONE', done.body);
  check('cannot mark it cleaned twice', (await call('POST', `/rental/stays/cleanings/${cl[0].id}/done`, C, {})).status === 400);
  const extra = await call('POST', '/rental/stays/cleanings', A, { unitId: u1.id, dueDate: inDays(1), notes: 'Deep clean' });
  check('a cleaning can be added on its own', extra.status === 201 && extra.body.cleanerName === 'Mama Wanjiru', extra.body);

  // -- Cancel and no-show --
  const later = await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Maybe', checkIn: inDays(20), checkOut: inDays(22) });
  check('caretaker cannot cancel', (await call('POST', `/rental/stays/${later.body.id}/cancel`, C, { reason: 'no' })).status === 403);
  check('a no-show before the arrival day is refused', (await call('POST', `/rental/stays/${later.body.id}/no-show`, A, { reason: 'did not come' })).status === 400);
  const cancelled = await call('POST', `/rental/stays/${later.body.id}/cancel`, A, { reason: 'Guest changed plans' });
  check('booking cancelled', cancelled.body.status === 'CANCELLED' && cancelled.body.cancelReason === 'Guest changed plans', cancelled.body);
  const again = await call('POST', '/rental/stays', A, { unitId: u1.id, guestName: 'Rebook', checkIn: inDays(20), checkOut: inDays(22) });
  check('cancelled dates can be booked again', again.status === 201, again.body);
  const cancelledList = (await call('GET', '/rental/stays?view=cancelled', A)).body;
  check('cancelled list', cancelledList.length === 1, cancelledList);
  const clAfter = (await call('GET', '/rental/stays/cleanings?view=done', A)).body;
  check('done cleanings list', clAfter.length === 1, clAfter);

  // -- Owners and statements --
  const owner = await call('POST', '/rental/stays/owners', A, { name: 'Jane Mwangi', email: 'jane@example.test', commissionPercent: 20 });
  check('owner added', owner.status === 201, owner.body);
  check('two owners with the same name refused', (await call('POST', '/rental/stays/owners', A, { name: 'Jane Mwangi' })).status === 409);
  await call('PUT', `/rental/stays/units/${u1.id}`, A, { ...unitBody, ownerId: owner.body.id });
  await call('POST', '/rental/expenses', A, { propertyId: p1.id, unitId: u1.id, category: 'REPAIRS', description: 'Shower head', amount: 1000 });
  const month = inDays(0).slice(0, 7);
  const stmt = (await call('GET', `/rental/stays/statements?month=${month}&ownerId=${owner.body.id}`, A)).body;
  const jane = stmt.owners && stmt.owners[0];
  check("statement is the owner's units only", stmt.owners.length === 1 && jane.owner === 'Jane Mwangi' && jane.lines.length === 1, stmt);
  const t = jane && jane.totals;
  check('statement adds up: net less 20% less expenses', t && Math.abs(t.payable - (t.net - t.commission - t.expenses)) < 0.01 && Math.abs(t.commission - t.net * 0.2) < 0.02 && t.expenses === 1000, t);
  const own = (await call('GET', `/rental/stays/statements?month=${month}&ownerId=own`, A)).body;
  check("'own units' shows units with no owner", own.owners.length === 1 && own.owners[0].owner === 'Own units' && own.owners[0].lines[0].unit === 'W1', own);
  const csv = (await call('GET', `/rental/stays/statements?month=${month}&format=csv`, A)).body;
  check('statement downloads as CSV', typeof csv.csv === 'string' && csv.csv.startsWith('Owner,Property,Unit') && csv.csv.includes('Jane Mwangi total'), csv);
  check('a bad month is refused', (await call('GET', '/rental/stays/statements?month=2026-13', A)).status === 400);

  // -- Settings --
  const set = await call('PUT', '/rental/stays/settings', A, { stayTexts: true });
  check('guest texts can be switched on', set.status === 200 && set.body.stayTexts === true, set.body);
  check('landlord B sees nothing of A', (await call('GET', '/rental/stays?view=all', B)).body.length === 0);

  // -- Advert on a short-stay unit --
  const advert = await call('PUT', `/rental/units/${u1.id}/listing`, A, { title: 'One bedroom in Kilimani', unitType: 'ONE_BEDROOM', area: 'Kilimani', monthlyRent: 30000, depositAmount: 0, contactPhone: '0711000000' });
  check('a short-stay unit cannot be advertised as a house to let', advert.status === 409, advert.body);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
