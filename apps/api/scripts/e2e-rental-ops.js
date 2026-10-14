// End-to-end check of the rental module's day-to-day running (expenses, maintenance, meters, reminder settings and
// the monthly report) against a LOCAL throwaway API (see ONLINE_SHOP_TESTING.md).
//   node scripts/e2e-rental-ops.js [http://localhost:3001]
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
  return { status: res.status, body: json };
}

async function newLandlord(label) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `landlord-${label}-${suffix}@example.test`;
  const reg = await call('POST', '/auth/register', null, {
    organizationName: `Landlord ${label} ${suffix}`,
    industryType: 'RENTAL',
    ownerFullName: 'Test Owner',
    ownerEmail: email,
    ownerPassword: 'password123',
    branchName: 'Main',
  });
  if (reg.status >= 300) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  return (await call('POST', '/auth/login', null, { email, password: 'password123' })).body.accessToken;
}

const iso = (d) => d.toISOString().slice(0, 10);
const today = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

(async () => {
  const A = await newLandlord('A');
  const B = await newLandlord('B');

  const p1 = (await call('POST', '/rental/properties', A, { name: 'Ops Court' })).body;
  const p2 = (await call('POST', '/rental/properties', A, { name: 'Other Plaza' })).body;
  const u1 = (await call('POST', '/rental/units', A, { propertyId: p1.id, label: 'A1', monthlyRent: 10000 })).body;
  const uVacant = (await call('POST', '/rental/units', A, { propertyId: p1.id, label: 'A2', monthlyRent: 10000 })).body;
  const u2 = (await call('POST', '/rental/units', A, { propertyId: p2.id, label: 'B1', monthlyRent: 5000 })).body;
  const monthStart = new Date(Date.UTC(today().getUTCFullYear(), today().getUTCMonth(), 1));
  const tenant = await call('POST', '/rental/tenants', A, { name: 'Otieno', phone: '0711222333', unitId: u1.id, startDate: iso(monthStart), dueDay: 5 });
  const leaseId = tenant.body.lease.id;

  // -- Expenses --
  const e1 = await call('POST', '/rental/expenses', A, { propertyId: p1.id, category: 'REPAIRS', description: 'Fix gate', amount: 2500, vendor: 'Juma Welders' });
  check('expense recorded', e1.status === 201, e1.body);
  const eFuture = await call('POST', '/rental/expenses', A, { propertyId: p1.id, category: 'OTHER', description: 'Later', amount: 10, incurredAt: iso(new Date(Date.now() + 5 * 86400000)) });
  check('future-dated expense refused', eFuture.status === 400, eFuture.status);
  const eWrongUnit = await call('POST', '/rental/expenses', A, { propertyId: p1.id, unitId: u2.id, category: 'OTHER', description: 'wrong', amount: 10 });
  check('a unit from another property is refused', eWrongUnit.status === 400, eWrongUnit.status);
  const eNegative = await call('POST', '/rental/expenses', A, { propertyId: p1.id, category: 'OTHER', description: 'neg', amount: -5 });
  check('negative expense refused', eNegative.status === 400);
  const e2 = await call('POST', '/rental/expenses', A, { propertyId: p2.id, category: 'RATES_AND_TAXES', description: 'Land rates', amount: 1000 });
  const eList = (await call('GET', `/rental/expenses?propertyId=${p1.id}`, A)).body;
  check('expense list filters by property', eList.length === 1 && eList[0].amount === 2500, eList);
  const eDel = await call('DELETE', `/rental/expenses/${e2.body.id}`, A);
  check('an expense can be deleted', eDel.status === 200 && eDel.body.deleted === true);

  // -- Maintenance --
  const m1 = await call('POST', '/rental/maintenance', A, { propertyId: p1.id, unitId: u1.id, tenantId: tenant.body.id, title: 'Leaking tap', priority: 'URGENT' });
  check('maintenance request created', m1.status === 201 && m1.body.status === 'OPEN', m1.body);
  const mProg = await call('PATCH', `/rental/maintenance/${m1.body.id}`, A, { status: 'IN_PROGRESS' });
  check('can be marked in progress', mProg.body.status === 'IN_PROGRESS' && mProg.body.resolvedAt === null, mProg.body);
  await call('POST', '/rental/expenses', A, { propertyId: p1.id, unitId: u1.id, maintenanceId: m1.body.id, category: 'REPAIRS', description: 'Plumber', amount: 1800 });
  const mDone = await call('PATCH', `/rental/maintenance/${m1.body.id}`, A, { status: 'DONE' });
  check('done stamps the resolved date', mDone.body.status === 'DONE' && !!mDone.body.resolvedAt, mDone.body);
  const mList = (await call('GET', '/rental/maintenance?status=DONE', A)).body;
  check('the repair shows what it cost', mList.length === 1 && mList[0].cost === 1800 && mList[0].reportedBy === 'Otieno', mList);
  const mReopen = await call('PATCH', `/rental/maintenance/${m1.body.id}`, A, { status: 'OPEN' });
  check('reopening clears the resolved date', mReopen.body.resolvedAt === null);

  // -- Meters --
  const r0 = await call('POST', '/rental/meters', A, { unitId: u1.id, kind: 'WATER', reading: 100, readingDate: iso(daysAgo(30)), ratePerUnit: 150 });
  check('first reading is only a starting point (nothing billed)', r0.status === 201 && r0.body.billedToTenant === false && r0.body.unitsUsed === null, r0.body);
  const r1 = await call('POST', '/rental/meters', A, { unitId: u1.id, kind: 'WATER', reading: 112.5, readingDate: iso(daysAgo(1)) });
  check('second reading bills 12.5 units at the remembered rate (1,875)', r1.body.billedToTenant === true && r1.body.charged === 1875 && r1.body.unitsUsed === 12.5, r1.body);
  const dues = (await call('GET', '/rental/dues', A)).body.find((r) => r.leaseId === leaseId);
  check('the water charge is on the tenant balance (rent 10,000 + water 1,875)', dues.outstanding === 11875, dues);
  const rLow = await call('POST', '/rental/meters', A, { unitId: u1.id, kind: 'WATER', reading: 50, readingDate: iso(today()) });
  check('a lower reading than before is refused', rLow.status === 400, rLow.body);
  const rDup = await call('POST', '/rental/meters', A, { unitId: u1.id, kind: 'WATER', reading: 120, readingDate: iso(daysAgo(1)) });
  check('a second reading on the same date is refused (409)', rDup.status === 409, rDup.status);
  const rEarlier = await call('POST', '/rental/meters', A, { unitId: u1.id, kind: 'WATER', reading: 105, readingDate: iso(daysAgo(10)) });
  check('readings must be entered in date order', rEarlier.status === 400, rEarlier.status);
  const rElec = await call('POST', '/rental/meters', A, { unitId: u1.id, kind: 'ELECTRICITY', reading: 2000, previousReading: 1900, ratePerUnit: 28 });
  check('a first reading with a stated previous reading bills straight away (100 x 28)', rElec.body.charged === 2800, rElec.body);
  const rVacant = await call('POST', '/rental/meters', A, { unitId: uVacant.id, kind: 'WATER', reading: 10, previousReading: 5, ratePerUnit: 100 });
  check('a vacant unit saves the reading but bills nobody', rVacant.status === 201 && rVacant.body.billedToTenant === false && /no tenant/i.test(rVacant.body.note), rVacant.body);
  const rList = (await call('GET', `/rental/meters?unitId=${u1.id}`, A)).body;
  check('readings list', rList.length === 3, rList.length);

  // -- Report --
  await call('POST', '/rental/payments', A, { leaseId, amount: 4000, method: 'CASH' });
  const rep = (await call('GET', '/rental/reports/monthly', A)).body;
  const ops = rep.properties.find((x) => x.property === 'Ops Court');
  check('report: collected 4,000 this month', ops.collected === 4000, ops);
  check('report: expenses 2,500 + 1,800 = 4,300', ops.expenses === 4300, ops);
  check('report: net = collected - expenses', ops.net === -300, ops);
  check('report: occupancy 1 of 2 units', ops.units === 2 && ops.occupied === 1, ops);
  check('report totals add up', rep.totals.collected === 4000 && rep.totals.expenses === 4300, rep.totals);
  check('report: expenses by category', rep.expensesByCategory.find((c) => c.category === 'REPAIRS')?.amount === 4300, rep.expensesByCategory);
  const badMonth = await call('GET', '/rental/reports/monthly?month=2026-13', A);
  check('a bad month is refused', badMonth.status === 400);
  const oldMonth = (await call('GET', '/rental/reports/monthly?month=2020-01', A)).body;
  check('an old month reports zeros', oldMonth.totals.collected === 0 && oldMonth.totals.expenses === 0);

  // -- Reminder settings --
  const s0 = (await call('GET', '/rental/reminders/settings', A)).body;
  check('reminders start switched off', s0.remindersEnabled === false && s0.smsReminders === false, s0);
  const s1 = (await call('PATCH', '/rental/reminders/settings', A, { remindersEnabled: true, paymentInstructions: 'Paybill 123456, account A1' })).body;
  check('reminder settings save', s1.remindersEnabled === true && s1.paymentInstructions === 'Paybill 123456, account A1', s1);
  const send = await call('POST', '/rental/reminders/send', A, { leaseId });
  check('a manual reminder to a tenant with no email or SMS is refused clearly', send.status === 400 && /email/i.test(JSON.stringify(send.body)), send.body);

  // -- Isolation --
  check('another landlord sees no expenses', (await call('GET', '/rental/expenses', B)).body.length === 0);
  check('another landlord sees no maintenance', (await call('GET', '/rental/maintenance', B)).body.length === 0);
  check('another landlord sees no meter readings', (await call('GET', '/rental/meters', B)).body.length === 0);
  check('another landlord cannot add an expense to our property (404)', (await call('POST', '/rental/expenses', B, { propertyId: p1.id, category: 'OTHER', description: 'x', amount: 5 })).status === 404);
  check('another landlord cannot read a meter on our unit (404)', (await call('POST', '/rental/meters', B, { unitId: u1.id, kind: 'WATER', reading: 5 })).status === 404);
  check('another landlord cannot update our maintenance (404)', (await call('PATCH', `/rental/maintenance/${m1.body.id}`, B, { status: 'DONE' })).status === 404);
  check('another landlord cannot delete our expense (404)', (await call('DELETE', `/rental/expenses/${e1.body.id}`, B)).status === 404);
  check('another landlord report is empty', (await call('GET', '/rental/reports/monthly', B)).body.totals.collected === 0);
  check('another landlord reminder settings are their own', (await call('GET', '/rental/reminders/settings', B)).body.remindersEnabled === false);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed: ' + failures.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Test crashed:', e.message);
  process.exit(1);
});
