// End-to-end check of the rental module's rent billing against a LOCAL throwaway API (see ONLINE_SHOP_TESTING.md).
//   node scripts/e2e-rental.js [http://localhost:3001]
// It registers fresh landlords each run, so it can be re-run on the same test database.
const BASE = process.argv[2] || 'http://localhost:3001';
let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed++;
  } else {
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
  const login = await call('POST', '/auth/login', null, { email, password: 'password123' });
  const token = login.body.accessToken ?? reg.body.accessToken;
  if (!token) throw new Error(`no token: ${JSON.stringify(login.body)}`);
  return token;
}

const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 1) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day));
};

(async () => {
  const A = await newLandlord('A');
  const B = await newLandlord('B');

  // ── Setup: property, units, tenant moved in two months ago ──
  const prop = (await call('POST', '/rental/properties', A, { name: 'Test Court' })).body;
  check('property created', !!prop.id, prop);
  const bulk = await call('POST', '/rental/units/bulk', A, { propertyId: prop.id, labels: ['A1', 'A2', 'A3'], monthlyRent: 10000, depositAmount: 10000 });
  check('bulk units created', bulk.body.created === 3, bulk.body);
  const bulk2 = await call('POST', '/rental/units/bulk', A, { propertyId: prop.id, labels: ['A3', 'A4'], monthlyRent: 10000 });
  check('bulk skips existing labels', bulk2.body.created === 1 && bulk2.body.skipped[0] === 'A3', bulk2.body);

  const units = (await call('POST', '/rental/units', A, { propertyId: prop.id, label: 'Z9', monthlyRent: 10000, depositAmount: 10000 })).body;
  const start = monthsAgo(2, 3);
  const tenant = await call('POST', '/rental/tenants', A, { name: 'Wanjiku', phone: '0712345678', unitId: units.id, startDate: iso(start), dueDay: 5 });
  check('tenant + lease created together', !!tenant.body.lease, tenant.body);
  const leaseId = tenant.body.lease.id;

  // ── Invoices were generated on lease start ──
  let invoices = (await call('GET', `/rental/invoices?leaseId=${leaseId}`, A)).body;
  const rent = invoices.filter((i) => i.kind === 'RENT');
  const deposit = invoices.filter((i) => i.kind === 'DEPOSIT');
  check('3 rent invoices (start month + 2)', rent.length === 3, invoices.length);
  check('1 deposit invoice', deposit.length === 1 && deposit[0].amountDue === 10000);
  const gen = await call('POST', '/rental/billing/generate', A);
  check('generating again creates nothing (idempotent)', gen.body.created === 0, gen.body);

  let dues = (await call('GET', '/rental/dues', A)).body;
  const row = dues.find((r) => r.leaseId === leaseId);
  check('dues: 40,000 outstanding', row && row.outstanding === 40000, row);
  check('dues: overdue includes the old months', row && row.overdue >= 30000, row);

  // ── Manual payments ──
  const p1 = await call('POST', '/rental/payments', A, { leaseId, amount: 15000, method: 'MPESA', reference: 'tfg1h2j3k4' });
  check('payment recorded with a receipt number', p1.status === 201 && /^RR-\d{8}-/.test(p1.body.receiptNumber), p1.body);
  check('payment applied to the oldest invoices', p1.body.appliedTo.reduce((s, a) => s + a.amount, 0) === 15000, p1.body.appliedTo);
  check('reference stored upper-case', p1.body.reference === 'TFG1H2J3K4');
  check('balance after = 25,000', p1.body.balanceAfter === 25000, p1.body.balanceAfter);

  const dup = await call('POST', '/rental/payments', A, { leaseId, amount: 100, method: 'MPESA', reference: 'TFG1H2J3K4' });
  check('same M-Pesa code cannot be recorded twice (409)', dup.status === 409, dup);
  const bad = await call('POST', '/rental/payments', A, { leaseId, amount: 0, method: 'CASH' });
  check('zero amount rejected', bad.status === 400);
  const tumaForged = await call('POST', '/rental/payments', A, { leaseId, amount: 5, method: 'TUMA' });
  check('a person cannot record a "TUMA" payment by hand', tumaForged.status === 400, tumaForged.status);
  const future = await call('POST', '/rental/payments', A, { leaseId, amount: 5, method: 'CASH', paidAt: iso(monthsAgo(-1)) });
  check('future-dated payment rejected', future.status === 400, future.status);

  // overpay: pays everything and leaves credit
  const p2 = await call('POST', '/rental/payments', A, { leaseId, amount: 30000, method: 'CASH' });
  check('overpayment keeps 5,000 as credit', p2.body.keptAsCredit === 5000 && p2.body.balanceAfter === 0, p2.body);
  dues = (await call('GET', '/rental/dues', A)).body;
  const row2 = dues.find((r) => r.leaseId === leaseId);
  check('dues: nothing owed, 5,000 credit', row2.outstanding === 0 && row2.credit === 5000, row2);

  // a one-off charge uses the credit straight away
  const charge = await call('POST', '/rental/invoices', A, { leaseId, description: 'Water bill', amount: 3000 });
  check('charge created', charge.status === 201, charge.body);
  dues = (await call('GET', '/rental/dues', A)).body;
  const row3 = dues.find((r) => r.leaseId === leaseId);
  check('credit paid the water bill (credit 2,000)', row3.outstanding === 0 && row3.credit === 2000, row3);

  // ── Void ──
  const voided = await call('POST', `/rental/payments/${p2.body.id}/void`, A, { reason: 'Entered in error' });
  check('void marks the receipt voided', voided.body.voided === true, voided.body);
  dues = (await call('GET', '/rental/dues', A)).body;
  const row4 = dues.find((r) => r.leaseId === leaseId);
  check('after voiding the 30,000, balance is back to 28,000', row4.outstanding === 28000, row4);
  const voidAgain = await call('POST', `/rental/payments/${p2.body.id}/void`, A, { reason: 'again' });
  check('cannot void twice (409)', voidAgain.status === 409);

  // ── Statement ──
  const st = (await call('GET', `/rental/leases/${leaseId}/statement`, A)).body;
  check('statement balance matches dues', st.balance === 28000, st.balance);
  check('statement has charges and payments', st.lines.some((l) => l.charge > 0) && st.lines.some((l) => l.paid > 0));

  // ── Another landlord sees none of it ──
  const spy = await call('GET', `/rental/payments/${p1.body.id}`, B);
  check("another landlord cannot open this receipt (404)", spy.status === 404, spy.status);
  const spyDues = (await call('GET', '/rental/dues', B)).body;
  check('another landlord sees no dues', Array.isArray(spyDues) && spyDues.length === 0, spyDues);
  const spyPay = await call('POST', '/rental/payments', B, { leaseId, amount: 100, method: 'CASH' });
  check("another landlord cannot pay into this lease (404)", spyPay.status === 404, spyPay.status);

  // ── End the lease with a deposit refund ──
  const tooMuch = await call('PATCH', `/rental/leases/${leaseId}/end`, A, { depositRefunded: 99999 });
  check('refund above what was paid is refused', tooMuch.status === 400, tooMuch.status);
  const ended = await call('PATCH', `/rental/leases/${leaseId}/end`, A, { depositRefunded: 4000 });
  check('lease ends with a partial refund', ended.status === 200 && Number(ended.body.depositRefunded) === 4000, ended.body);
  const after = await call('POST', '/rental/billing/generate', A);
  check('an ended lease stops billing', after.body.created === 0, after.body);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed: ' + failures.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Test crashed:', e.message);
  process.exit(1);
});
