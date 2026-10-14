// End-to-end check of automatic M-Pesa rent collection against a LOCAL throwaway API and the PRETEND Tuma
// (see ONLINE_SHOP_TESTING.md). Start both first:
//   node scripts/mock-tuma.js
//   node scripts/with-env-local.js node dist/src/main
// then:
//   node scripts/e2e-rental-mpesa.js [apiBase] [mockTumaBase]
// It registers fresh landlords each run, so it can be re-run on the same test database.
const BASE = process.argv[2] || 'http://localhost:3001';
const TUMA = process.argv[3] || 'http://localhost:4010';
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

async function call(method, path, token, body, base = BASE) {
  const res = await fetch(base + path, {
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
  return { status: res.status, body: json, raw: text };
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
  return login.body.accessToken;
}

const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n, day = 1) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pushFor(requestId) {
  const pushes = (await call('GET', '/_test/pushes', null, undefined, TUMA)).body;
  return pushes.find((p) => p.callback_url.includes(`/${requestId}/`));
}

// Waits for the API to have processed a callback (it answers 200 straight away but works inside).
async function waitFor(fn, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
}

(async () => {
  const A = await newLandlord('A');
  const B = await newLandlord('B');

  const prop = (await call('POST', '/rental/properties', A, { name: 'M-Pesa Court' })).body;
  await call('POST', '/rental/units/bulk', A, { propertyId: prop.id, labels: ['M1', 'M2', 'M3', 'M4'], monthlyRent: 10000 });
  const units = (await call('GET', `/rental/units?propertyId=${prop.id}`, A)).body;
  const leases = [];
  for (const [i, u] of units.entries()) {
    const t = await call('POST', '/rental/tenants', A, { name: `Tenant ${i + 1}`, phone: `07120000${String(i).padStart(2, '0')}`, unitId: u.id, startDate: iso(monthsAgo(1, 2)), dueDay: 5 });
    leases.push(t.body.lease.id);
  }
  const owes = async (leaseId) => (await call('GET', '/rental/dues', A)).body.find((r) => r.leaseId === leaseId);

  // ── Settings ──
  const noSettings = await call('POST', '/rental/mpesa/requests', A, { leaseId: leases[0], amount: 5000 });
  check('cannot send a prompt before M-Pesa is connected (400)', noSettings.status === 400, noSettings.status);

  const wrong = await call('POST', '/rental/mpesa/tuma', A, { email: 'landlord@example.test', apiKey: 'wrong-key' });
  check('a wrong Tuma key is refused', wrong.status >= 400 && wrong.status < 500, wrong.status);
  const connected = await call('POST', '/rental/mpesa/tuma', A, { email: 'landlord@example.test', apiKey: 'a-valid-test-key-123' });
  check('Tuma connects', connected.status === 201 && connected.body.tumaConnected === true && connected.body.ready === true, connected.body);
  check('the API key is never sent back', !/a-valid-test-key|apiKey|Encrypted/.test(connected.raw), connected.raw);
  const got = await call('GET', '/rental/mpesa/settings', A);
  check('settings read back without secrets', got.body.tumaEmail === 'landlord@example.test' && !/Encrypted|a-valid-test-key/.test(got.raw));
  const otherSettings = await call('GET', '/rental/mpesa/settings', B);
  check("another landlord does not see these settings", otherSettings.body.tumaConnected === false, otherSettings.body);

  // ── Happy path: prompt -> pay -> callback -> recorded + applied ──
  const req1 = await call('POST', '/rental/mpesa/requests', A, { leaseId: leases[0], amount: 10000 });
  check('prompt sent (PENDING with a phone)', req1.status === 201 && req1.body.status === 'PENDING' && req1.body.phone.startsWith('254'), req1.body);
  const dupe = await call('POST', '/rental/mpesa/requests', A, { leaseId: leases[0], amount: 10000 });
  check('a second prompt within a minute is refused (409)', dupe.status === 409, dupe.status);

  const push1 = await pushFor(req1.body.id);
  check('Tuma received the prompt with a secret callback address', !!push1 && /\/public\/rental-payments\/.+\/tuma-callback\/.+/.test(push1.callback_url), push1 && push1.callback_url);

  // forged: wrong token must be refused
  const forgedUrl = push1.callback_url.replace(/\/tuma-callback\/.+$/, '/tuma-callback/not-the-token');
  const forged = await fetch(forgedUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed', amount: 10000, mpesa_receipt_number: 'FORGED1', merchant_request_id: push1.merchant_request_id }) });
  check('a callback with the wrong token is refused (404)', forged.status === 404, forged.status);
  const before = (await owes(leases[0])).outstanding;
  await sleep(500);
  check('...and nothing was paid', (await owes(leases[0])).outstanding === before);

  await call('POST', `/_test/pay/${push1.merchant_request_id}`, null, undefined, TUMA);
  const paid = await waitFor(async () => (await call('GET', '/rental/payments', A)).body.find((p) => p.reference === push1.receipt));
  check('the confirmed prompt became a recorded payment (method TUMA)', paid && paid.method === 'TUMA' && paid.amount === 10000, paid);
  const after = (await owes(leases[0])).outstanding;
  check('and was applied to what the tenant owes', after === before - 10000, { before, after });
  const reqs = (await call('GET', '/rental/mpesa/requests', A)).body;
  check('the request now reads PAID with the receipt', reqs.find((r) => r.id === req1.body.id)?.status === 'PAID');

  // replay: the same callback again must not pay twice
  await call('POST', `/_test/pay/${push1.merchant_request_id}`, null, undefined, TUMA);
  await sleep(800);
  const payments = (await call('GET', '/rental/payments', A)).body.filter((p) => p.reference === push1.receipt);
  check('a replayed callback does not pay twice', payments.length === 1, payments.length);
  check('amounts unchanged after the replay', (await owes(leases[0])).outstanding === after);

  // ── Forged success claims must not settle ──
  const req2 = await call('POST', '/rental/mpesa/requests', A, { leaseId: leases[1], amount: 10000 });
  const push2 = await pushFor(req2.body.id);
  const owes2 = (await owes(leases[1])).outstanding;
  await call('POST', `/_test/forge/${push2.merchant_request_id}?mode=underpay`, null, undefined, TUMA);
  await sleep(800);
  check('an underpaid "success" does not settle', (await owes(leases[1])).outstanding === owes2);
  const r2 = (await call('GET', '/rental/mpesa/requests', A)).body.find((r) => r.id === req2.body.id);
  check('it is flagged for review instead', r2.status === 'REVIEW', r2);

  // ── A failed prompt ──
  const req3 = await call('POST', '/rental/mpesa/requests', A, { leaseId: leases[2], amount: 10000 });
  const push3 = await pushFor(req3.body.id);
  await call('POST', `/_test/fail/${push3.merchant_request_id}`, null, undefined, TUMA);
  const failed = await waitFor(async () => (await call('GET', '/rental/mpesa/requests', A)).body.find((r) => r.id === req3.body.id && r.status === 'FAILED'));
  check('a cancelled prompt reads FAILED', !!failed, failed);
  check('and nothing was paid', (await owes(leases[2])).outstanding === 20000);

  // ── Callback never arrives: "check now" asks Tuma and settles ──
  const req4 = await call('POST', '/rental/mpesa/requests', A, { leaseId: leases[3], amount: 10000 });
  const push4 = await pushFor(req4.body.id);
  await call('POST', `/_test/pay-silent/${push4.merchant_request_id}`, null, undefined, TUMA);
  const checked = await call('POST', `/rental/mpesa/requests/${req4.body.id}/check`, A);
  check('"check now" finds the payment and records it', checked.body.status === 'PAID', checked.body);
  const secondCheck = await call('POST', `/rental/mpesa/requests/${req4.body.id}/check`, A);
  check('checking a settled request is harmless', secondCheck.status === 200 && secondCheck.body.status === 'PAID');

  // ── Isolation ──
  const spy = await call('GET', '/rental/mpesa/requests', B);
  check("another landlord sees none of these prompts", Array.isArray(spy.body) && spy.body.length === 0, spy.body);
  const spyCheck = await call('POST', `/rental/mpesa/requests/${req4.body.id}/check`, B);
  check("another landlord cannot check them (404)", spyCheck.status === 404, spyCheck.status);
  const spyPrompt = await call('POST', '/rental/mpesa/requests', B, { leaseId: leases[0], amount: 5000 });
  check("another landlord cannot prompt our tenant (400/404)", spyPrompt.status === 404 || spyPrompt.status === 400, spyPrompt.status);

  // ── Disconnect ──
  const off = await call('DELETE', '/rental/mpesa/tuma', A);
  check('disconnecting Tuma works', off.body.tumaConnected === false && off.body.ready === false, off.body);

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed: ' + failures.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Test crashed:', e.message);
  process.exit(1);
});
