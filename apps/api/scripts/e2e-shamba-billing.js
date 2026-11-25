// End-to-end check of Shamba billing against the LOCAL API (port 3001): plan payments by M-Pesa (mock Tuma on 4010), SMS
// bundles, the wage payout fee (mock Daraja B2C on 4030, API started with MPESA_B2C_BASE_URL=http://localhost:4030), fee
// invoices, and the platform admin farm screen. Needs the seeded demo farm. Never touches the live system.
const API = "http://localhost:3001";
const TUMA = "http://localhost:4010";
const PAY_DAY = Number(process.env.PAY_DAY ?? -16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + String(JSON.stringify(detail)).slice(0, 300)}`); };

async function call(token, method, path, body, base = API) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;
const day = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(500);
  }
};
const lastPush = async () => {
  const pushes = (await call(null, "GET", "/_test/pushes", null, TUMA)).body;
  const p = (Array.isArray(pushes) ? pushes : Object.values(pushes ?? {})).slice(-1)[0];
  return p.merchant_request_id ?? p.merchantRequestId;
};

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const manager = await signIn("manager@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");
  const admin = (await call(null, "POST", "/platform-admin/auth/login", { email: "admin@test.local", password: "test-admin-password" })).body?.accessToken;

  // ── The farm's plan screen ──
  const plan0 = (await call(owner, "GET", "/farm/plan")).body;
  check("the plan screen shows the plan, SMS credits, plans on offer and SMS bundles", plan0.planCode && typeof plan0.smsCredits === "number" && plan0.plans.length >= 4 && plan0.smsBundles.length > 0, { planCode: plan0.planCode, sms: plan0.smsCredits, bundles: plan0.smsBundles?.length });
  check("a herdsman cannot open the plan", (await call(herd, "GET", "/farm/plan")).status === 403);
  const small = await call(owner, "POST", "/farm/plan/pay", { planCode: "FARM_MKULIMA", cycle: "MONTHLY", phone: "0712000001" });
  check("a plan the farm does not fit is refused, saying why", small.status === 400 && /does not fit/.test(small.body.message), small.body);
  const quote = await call(owner, "POST", "/farm/plan/pay", { planCode: "FARM_ESTATE", cycle: "MONTHLY", phone: "0712000001" });
  check("the Estate plan is by quote", quote.status === 400 && /quote/.test(quote.body.message), quote.body);

  // ── Paying for the plan by M-Pesa ──
  const end0 = new Date(plan0.currentPeriodEnd);
  const started = (await call(owner, "POST", "/farm/plan/pay", { planCode: "FARM_FARMER", cycle: "MONTHLY", phone: "0712000001" })).body;
  check("paying for Farmer sends ZARODA's M-Pesa prompt (KES 2,500)", started.status === "PENDING" && started.amount === 2500, started);
  const again = await call(owner, "POST", "/farm/plan/pay", { planCode: "FARM_FARMER", cycle: "MONTHLY", phone: "0712000001" });
  check("a second prompt within a minute is refused", again.status === 400, again.body);
  await call(null, "POST", `/_test/pay/${await lastPush()}`, null, TUMA);
  const paid = await until(async () => {
    const p = (await call(owner, "GET", "/farm/plan")).body;
    return p.payments.find((x) => x.id === started.id && x.status === "PAID") ? p : null;
  });
  const from = new Date(Math.max(end0.getTime(), Date.now()));
  from.setUTCMonth(from.getUTCMonth() + 1);
  check("Tuma's callback settles it: the plan is active a month further on", paid && paid.status === "ACTIVE" && Math.abs(new Date(paid.currentPeriodEnd) - from) < 86_400_000, { status: paid?.status, end0, end1: paid?.currentPeriodEnd });

  // ── SMS bundle ──
  await sleep(61_000);
  const bundle = plan0.smsBundles[0];
  const smsStart = (await call(manager, "POST", "/farm/plan/sms", { bundleCode: bundle.code, phone: "0712000002" })).body;
  await call(null, "POST", `/_test/pay/${await lastPush()}`, null, TUMA);
  const afterSms = await until(async () => {
    const p = (await call(owner, "GET", "/farm/plan")).body;
    return p.payments.find((x) => x.id === smsStart.id && x.status === "PAID") ? p : null;
  });
  check(`an SMS bundle adds ${bundle.sms} credits`, afterSms && afterSms.smsCredits === paid.smsCredits + bundle.sms, { before: paid?.smsCredits, after: afterSms?.smsCredits });

  // ── Wage paid by M-Pesa -> ZARODA's payout fee ──
  const fees0 = (await call(owner, "GET", "/farm/plan")).body.feesThisMonth;
  await call(owner, "PUT", "/farm/labour/payout-account", { environment: "sandbox", shortcode: "600000", initiator: "testapi", consumerKey: "test-key", consumerSecret: "test-secret", securityCredential: "test-credential" });
  const workers = (await call(manager, "GET", "/farm/labour/workers")).body;
  await call(manager, "PUT", "/farm/labour/muster", { date: day(PAY_DAY), entries: workers.slice(0, 2).map((w) => ({ workerId: w.id, status: "PRESENT" })) });
  const run = (await call(manager, "POST", "/farm/labour/runs", { periodStart: day(PAY_DAY), periodEnd: day(PAY_DAY) })).body;
  await call(owner, "POST", `/farm/labour/runs/${run.id}/approve`);
  const sent = await call(manager, "POST", `/farm/labour/runs/${run.id}/pay`, { method: "MPESA" });
  check("wages sent by M-Pesa B2C", sent.status === 201 && sent.body.lines.every((l) => l.status === "SENDING" || l.status === "PAID"), sent.body?.lines?.map((l) => [l.status, l.failureReason]));
  const settled = await until(async () => {
    const r = (await call(manager, "GET", `/farm/labour/runs/${run.id}`)).body;
    return r.status === "PAID" ? r : null;
  }, 20000);
  check("Safaricom's result marks each worker paid", settled?.status === "PAID", settled?.lines?.map((l) => l.status));
  const fees = (await call(owner, "GET", "/farm/plan")).body.feesThisMonth;
  check("ZARODA's fee is charged once per payout this month", fees.count - fees0.count === 2 && fees.total > fees0.total, { fees0, fees });

  // ── Last month's fees become an invoice, paid by M-Pesa ──
  const { execSync } = require("child_process");
  execSync(`docker exec zaroda-test-db psql -U postgres -d zaroda_test -qAtc "UPDATE farm_fee_charges SET \\"periodMonth\\" = to_char(now() - interval '${process.env.MONTHS_BACK ?? 1} month', 'YYYY-MM') WHERE \\"invoiceId\\" IS NULL"`);
  const withInvoice = (await call(owner, "GET", "/farm/plan")).body;
  const inv = withInvoice.invoices.find((i) => i.status === "UNPAID");
  check("a finished month's fees are rolled into an unpaid invoice", inv && Math.abs(inv.total - fees.total) < 0.01 && withInvoice.feesThisMonth.count === 0, { inv, fees: withInvoice.feesThisMonth });
  await sleep(61_000);
  const feeStart = (await call(owner, "POST", `/farm/plan/fees/${inv.id}/pay`, { phone: "0712000003" })).body;
  await call(null, "POST", `/_test/pay/${await lastPush()}`, null, TUMA);
  const feePaid = await until(async () => (await call(owner, "GET", "/farm/plan")).body.invoices.find((i) => i.id === inv.id && i.status === "PAID"));
  check("paying the fee invoice by M-Pesa marks it paid", !!feePaid && feeStart.amount === inv.total, { feeStart, feePaid });

  // ── Platform admin ──
  const plans = (await call(admin, "GET", "/platform-admin/farm/plans")).body;
  check("platform admin sees the farm plans", Array.isArray(plans) && plans.some((p) => p.code === "FARM_MKULIMA"), plans);
  const edited = await call(admin, "PATCH", "/platform-admin/farm/plans/FARM_MKULIMA", { monthlyPrice: 1200 });
  const offered = (await call(owner, "GET", "/farm/plan")).body.plans.find((p) => p.code === "FARM_MKULIMA");
  check("a price change reaches farms at once", edited.status === 200 && offered.monthlyPrice === 1200, offered);
  await call(admin, "PATCH", "/platform-admin/farm/plans/FARM_MKULIMA", { monthlyPrice: 1000 });
  const tenants = (await call(admin, "GET", "/platform-admin/farm/tenants")).body;
  const uriri = tenants.tenants.find((t) => t.name === "Uriri Dairy & Poultry Farm");
  check("the farms list shows the demo farm active with its MRR", uriri && uriri.status === "ACTIVE" && uriri.mrr === 2500 && tenants.mrr >= 2500, uriri);
  const ext = await call(admin, "POST", `/platform-admin/farm/tenants/${uriri.id}/extend-trial`, { days: 7 });
  check("a paid farm's trial cannot be extended", ext.status === 409, ext.body);
  const rec = await call(admin, "POST", `/platform-admin/farm/tenants/${uriri.id}/payments`, { planCode: "FARM_FARMER", cycle: "ANNUAL", amount: 25000, method: "BANK", reference: "EQ-123" });
  const afterYear = (await call(owner, "GET", "/farm/plan")).body;
  check("a bank payment recorded by the admin adds a year", rec.status === 201 && rec.body.status === "PAID" && afterYear.cycle === "ANNUAL" && new Date(afterYear.currentPeriodEnd) - new Date(paid.currentPeriodEnd) > 360 * 86_400_000, { rec: rec.body?.status, cycle: afterYear.cycle });
  check("a farm token cannot use the platform admin routes", (await call(owner, "GET", "/platform-admin/farm/plans")).status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
