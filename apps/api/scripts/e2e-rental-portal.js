// End-to-end check of the TENANT portal (a tenant signing in with an emailed code, seeing only their own account,
// paying by M-Pesa, reporting a problem) against a LOCAL throwaway API and the PRETEND Tuma
// (see ONLINE_SHOP_TESTING.md). Start both first:
//   node scripts/mock-tuma.js
//   node scripts/with-env-local.js node dist/src/main      (send its output to a log file)
// then:
//   node scripts/e2e-rental-portal.js <path to the API's log file> [apiBase] [mockTumaBase]
// No email is sent in testing; the sign-in code is read from the API's log, like the shop test does.
const fs = require('fs');
const LOG = process.argv[2];
if (!LOG) {
  console.error('usage: node scripts/e2e-rental-portal.js <api log file> [apiBase] [mockTumaBase]');
  process.exit(2);
}
const BASE = process.argv[3] || 'http://localhost:3001';
const TUMA = process.argv[4] || 'http://localhost:4010';
let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

async function call(method, path, token, body, base = BASE, attempt = 0) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // The public sign-in routes allow 5 calls a minute; when the test hits that limit it waits it out.
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 62_000));
    return call(method, path, token, body, base, attempt + 1);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, raw: text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);

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

// The newest "Dev tenant login code for <email>: 123456" line in the API's log.
function codeFor(email) {
  const text = fs.readFileSync(LOG, 'utf8');
  // The API logs the address in lower case.
  const matches = [...text.matchAll(new RegExp(`Dev tenant login code for ${email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d{6})`, 'g'))];
  return matches.length ? matches[matches.length - 1][1] : null;
}

async function signIn(email) {
  const before = codeFor(email);
  const asked = await call('POST', '/tenant-auth/request-code', null, { email });
  if (asked.status !== 200) return { asked, token: null };
  let code = null;
  for (let i = 0; i < 20; i++) {
    code = codeFor(email);
    if (code && code !== before) break;
    code = null;
    await sleep(250);
  }
  return { asked, code, token: null };
}

(async () => {
  const L1 = await newLandlord('One');
  const L2 = await newLandlord('Two');
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `Wanjiku.${suffix}@Example.Test`; // mixed case on purpose
  const otherEmail = `someone-else-${suffix}@example.test`;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  // Landlord 1: property, two units, the tenant (with a login email) and a neighbour; Tuma connected for M-Pesa.
  const p1 = (await call('POST', '/rental/properties', L1, { name: 'Portal Court' })).body;
  const u1 = (await call('POST', '/rental/units', L1, { propertyId: p1.id, label: 'P1', monthlyRent: 10000 })).body;
  const u2 = (await call('POST', '/rental/units', L1, { propertyId: p1.id, label: 'P2', monthlyRent: 8000 })).body;
  const t1 = await call('POST', '/rental/tenants', L1, { name: 'Wanjiku', email, phone: '0712000001', unitId: u1.id, startDate: iso(monthStart), dueDay: 5 });
  const lease1 = t1.body.lease.id;
  const t2 = await call('POST', '/rental/tenants', L1, { name: 'Neighbour', email: otherEmail, phone: '0712000002', unitId: u2.id, startDate: iso(monthStart), dueDay: 5 });
  const lease2 = t2.body.lease.id;
  check('the tenant email is stored in lower case', t1.body.email === email.toLowerCase(), t1.body.email);
  await call('POST', '/rental/mpesa/tuma', L1, { email: 'landlord@example.test', apiKey: 'a-valid-test-key-123' });
  await call('PATCH', '/rental/reminders/settings', L1, { paymentInstructions: 'Paybill 123456' });

  // Landlord 2 rents to the SAME person (same email) in another building.
  const p2 = (await call('POST', '/rental/properties', L2, { name: 'Second Heights' })).body;
  const u3 = (await call('POST', '/rental/units', L2, { propertyId: p2.id, label: 'S1', monthlyRent: 6000 })).body;
  await call('POST', '/rental/tenants', L2, { name: 'Wanjiku K', email: email.toLowerCase(), unitId: u3.id, startDate: iso(monthStart), dueDay: 1 });

  // -- Sign-in --
  const unknown = await call('POST', '/tenant-auth/request-code', null, { email: `nobody-${suffix}@example.test` });
  check('an unknown address gets the same answer (no way to probe who is a tenant)', unknown.status === 200 && unknown.body.sent === true, unknown);
  await sleep(500);
  check('...but no code was made for it', codeFor(`nobody-${suffix}@example.test`) === null);

  const first = await signIn(email);
  check('a known tenant is sent a code', first.asked.status === 200 && !!first.code, first.asked.body);
  const wrong = await call('POST', '/tenant-auth/verify', null, { email, code: first.code === '000000' ? '111111' : '000000' });
  check('a wrong code is refused (401)', wrong.status === 401, wrong.status);
  const ok = await call('POST', '/tenant-auth/verify', null, { email, code: first.code });
  check('the right code signs in', ok.status === 200 && !!ok.body.accessToken, ok.body);
  const token = ok.body.accessToken;
  const reuse = await call('POST', '/tenant-auth/verify', null, { email, code: first.code });
  check('a code cannot be used twice (401)', reuse.status === 401, reuse.status);

  // brute force: five wrong guesses lock a code
  const second = await signIn(email);
  let locked = true;
  for (let i = 0; i < 5; i++) await call('POST', '/tenant-auth/verify', null, { email, code: second.code === '123456' ? '654321' : '123456' });
  const afterLock = await call('POST', '/tenant-auth/verify', null, { email, code: second.code });
  check('five wrong guesses lock the code even for the right answer', afterLock.status === 401, afterLock.status);

  // -- Token separation --
  check('a tenant token does not open landlord screens (401)', (await call('GET', '/rental/dues', token)).status === 401);
  check('a landlord token does not open the tenant portal (401)', (await call('GET', '/tenant-portal/me', L1)).status === 401);
  check('no token at all is refused (401)', (await call('GET', '/tenant-portal/me', null)).status === 401);
  const riderStyle = await call('GET', '/rider/me', token);
  check('a tenant token does not pass as a rider (401)', riderStyle.status === 401, riderStyle.status);

  // -- What the tenant sees --
  const me = (await call('GET', '/tenant-portal/me', token)).body;
  check('two landlords, one sign-in: two tenancies', me.tenancies.length === 2, me.tenancies && me.tenancies.length);
  const mine = me.tenancies.find((t) => t.leases.some((l) => l.leaseId === lease1));
  check('the tenancy shows the landlord, unit and balance', mine && /Landlord One/.test(mine.business) && mine.leases[0].unit === 'P1' && mine.leases[0].outstanding === 10000, mine);
  check('payment instructions and M-Pesa readiness come through', mine.paymentInstructions === 'Paybill 123456' && mine.canPayByMpesa === true, mine);
  check('the neighbour is nowhere in it', !JSON.stringify(me).includes('Neighbour') && !JSON.stringify(me).includes(lease2), me);
  const other = me.tenancies.find((t) => t.leases.some((l) => l.leaseId !== lease1));
  check('the second landlord tenancy cannot take M-Pesa yet', other.canPayByMpesa === false, other);

  // -- Reaching for someone else's things --
  check("another tenant's lease statement is not found (404)", (await call('GET', `/tenant-portal/leases/${lease2}/statement`, token)).status === 404);
  const neighbourToken = (await (async () => {
    const s = await signIn(otherEmail);
    return (await call('POST', '/tenant-auth/verify', null, { email: otherEmail, code: s.code })).body.accessToken;
  })());
  const neighbourPays = await call('POST', '/rental/payments', L1, { leaseId: lease2, amount: 500, method: 'CASH' });
  const neighbourReceipt = neighbourPays.body.id;
  check("another tenant's receipt is not found (404)", (await call('GET', `/tenant-portal/payments/${neighbourReceipt}`, token)).status === 404);
  check("another tenant cannot be paid for through my token (404)", (await call('POST', '/tenant-portal/pay', token, { leaseId: lease2, amount: 100 })).status === 404);
  check("another tenant's account is theirs", (await call('GET', '/tenant-portal/me', neighbourToken)).body.tenancies.length === 1);

  // -- Pay by M-Pesa --
  const tooMuch = await call('POST', '/tenant-portal/pay', token, { leaseId: lease1, amount: 99999 });
  check('paying more than owed is refused (400)', tooMuch.status === 400 && /owe/.test(JSON.stringify(tooMuch.body)), tooMuch.body);
  const prompt = await call('POST', '/tenant-portal/pay', token, { leaseId: lease1, amount: 4000 });
  check('a prompt is sent to the tenant phone', prompt.status === 201 && prompt.body.status === 'PENDING', prompt.body);
  const stillPending = (await call('GET', `/tenant-portal/prompts/${prompt.body.id}`, token)).body;
  check('the portal can follow the prompt', stillPending.status === 'PENDING');
  check("someone else cannot follow my prompt (404)", (await call('GET', `/tenant-portal/prompts/${prompt.body.id}`, neighbourToken)).status === 404);
  const pushes = (await call('GET', '/_test/pushes', null, undefined, TUMA)).body;
  const push = pushes.find((p) => p.callback_url.includes(`/${prompt.body.id}/`));
  await call('POST', `/_test/pay/${push.merchant_request_id}`, null, undefined, TUMA);
  let paid = null;
  for (let i = 0; i < 20 && !paid; i++) {
    const s = (await call('GET', `/tenant-portal/prompts/${prompt.body.id}`, token)).body;
    if (s.status === 'PAID') paid = s;
    else await sleep(250);
  }
  check('the confirmed payment shows as PAID with a payment id', paid && paid.paymentId, paid);
  const after = (await call('GET', '/tenant-portal/me', token)).body.tenancies.find((t) => t.leases.some((l) => l.leaseId === lease1));
  check('the balance dropped by 4,000', after.leases[0].outstanding === 6000, after.leases[0]);
  check('the payment is in the history', after.leases[0].payments.some((p) => p.amount === 4000), after.leases[0].payments);

  // -- Documents --
  const receipt = (await call('GET', `/tenant-portal/payments/${paid.paymentId}`, token)).body;
  check('the tenant can open their receipt', receipt.amount === 4000 && /^RR-/.test(receipt.receiptNumber), receipt);
  const statement = (await call('GET', `/tenant-portal/leases/${lease1}/statement`, token)).body;
  check('and their statement, matching the balance', statement.balance === 6000 && statement.lines.length >= 2, statement.balance);

  // -- Reporting a problem --
  const issue = await call('POST', '/tenant-portal/maintenance', token, { leaseId: lease1, title: 'Bathroom light out', description: 'Flickers then dies' });
  check('a problem can be reported', issue.status === 201 && issue.body.status === 'OPEN', issue.body);
  const landlordSees = (await call('GET', '/rental/maintenance', L1)).body.find((m) => m.title === 'Bathroom light out');
  check('the landlord sees it, marked as reported by the tenant', landlordSees && landlordSees.reportedBy === 'Wanjiku' && landlordSees.unit === 'P1', landlordSees);
  check("the other landlord does not see it", !(await call('GET', '/rental/maintenance', L2)).body.some((m) => m.title === 'Bathroom light out'));
  check('the tenant cannot report on a lease that is not theirs (404)', (await call('POST', '/tenant-portal/maintenance', token, { leaseId: lease2, title: 'Sneaky request' })).status === 404);
  for (let i = 0; i < 4; i++) await call('POST', '/tenant-portal/maintenance', token, { leaseId: lease1, title: `Another issue ${i}` });
  check('too many open requests are refused (400)', (await call('POST', '/tenant-portal/maintenance', token, { leaseId: lease1, title: 'One more' })).status === 400);

  // -- Invite from the landlord --
  const invite = await call('POST', `/rental/tenants/${t1.body.id}/invite`, L1);
  check('an invite is refused cleanly when email is not set up', invite.status === 400 && /email/i.test(JSON.stringify(invite.body)), invite.body);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed: ' + failures.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Test crashed:', e.message);
  process.exit(1);
});
