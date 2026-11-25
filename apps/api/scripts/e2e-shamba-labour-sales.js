// End-to-end check of Shamba F6 (labour and sales) against the LOCAL API (port 3001) and the seeded demo farm.
// Changes data: run on a freshly seeded farm. Needs a till on the demo farm (the farm seed makes "Farm gate till").
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;
const day = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const near = (a, b, d = 0.01) => Math.abs(a - b) < d;

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const manager = await signIn("manager@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");
  const today = day();

  // ── Labour ──
  const workers = (await call(manager, "GET", "/farm/labour/workers")).body;
  check("four casual workers", workers.length === 4, workers.map((w) => w.name));
  const otieno = workers.find((w) => w.name === "Otieno Ouma");
  const marked = await call(herd, "PUT", "/farm/labour/muster", { date: today, entries: workers.map((w) => ({ workerId: w.id, status: w.id === otieno.id ? "HALF_DAY" : "PRESENT", task: "Today's work" })) });
  check("the herdsman marks today's muster roll", marked.status === 200 && marked.body.present === 4, marked.body);
  const sheet = (await call(herd, "GET", `/farm/labour/muster?date=${today}`)).body;
  check("the muster shows Otieno on a half day", sheet.workers.find((w) => w.id === otieno.id).status === "HALF_DAY", sheet.workers);
  const tomorrow = await call(herd, "PUT", "/farm/labour/muster", { date: day(1), entries: [{ workerId: otieno.id, status: "PRESENT" }] });
  check("tomorrow cannot be marked", tomorrow.status === 400, tomorrow.body);
  const paidDay = await call(manager, "PUT", "/farm/labour/muster", { date: day(-10), entries: [{ workerId: otieno.id, status: "ABSENT" }] });
  check("a day in a paid pay run cannot be changed", paidDay.status === 409 && /approved pay run/.test(paidDay.body.message), paidDay.body);

  check("the herdsman cannot see pay runs", (await call(herd, "GET", "/farm/labour/runs")).status === 403);
  const overlap = await call(manager, "POST", "/farm/labour/runs", { periodStart: day(-8), periodEnd: today });
  check("a pay run cannot overlap the paid week", overlap.status === 409 && /WAGE-001/.test(overlap.body.message), overlap.body);
  const run = (await call(manager, "POST", "/farm/labour/runs", { periodStart: day(-6), periodEnd: today })).body;
  const ot = run.lines?.find((l) => l.workerId === otieno.id);
  check("a pay run from the muster: 4 workers, statutory deductions taken", run.status === "DRAFT" && run.lines.length === 4 && run.deductions > 0 && near(run.net, run.gross - run.deductions), { gross: run.gross, deductions: run.deductions, net: run.net });
  check("Otieno's days count today's half day", ot && ot.days % 1 === 0.5 && near(ot.gross, ot.days * 700), ot);
  const selfApprove = await call(manager, "POST", `/farm/labour/runs/${run.id}/approve`);
  check("whoever prepared a pay run cannot approve it", selfApprove.status === 403, selfApprove.body);
  const earlyPay = await call(manager, "POST", `/farm/labour/runs/${run.id}/pay`, { method: "CASH" });
  check("a pay run must be approved before paying", earlyPay.status === 409, earlyPay.body);
  const approved = await call(owner, "POST", `/farm/labour/runs/${run.id}/approve`);
  check("the owner approves it", approved.status === 201 && approved.body.status === "APPROVED", approved.body?.status);
  const noAccount = await call(manager, "POST", `/farm/labour/runs/${run.id}/pay`, { method: "MPESA" });
  check("M-Pesa needs the farm's payout account first", noAccount.status === 409 && /payout account/.test(noAccount.body.message), noAccount.body);
  const noCode = await call(manager, "POST", `/farm/labour/runs/${run.id}/pay`, { method: "MPESA_MANUAL" });
  check("a hand-made M-Pesa payment needs its code", noCode.status === 400, noCode.body);
  const paid = await call(manager, "POST", `/farm/labour/runs/${run.id}/pay`, { method: "CASH" });
  check("paid in cash: the run is paid", paid.status === 201 && paid.body.status === "PAID" && paid.body.lines.every((l) => l.status === "PAID"), paid.body?.status);
  const locked = await call(herd, "PUT", "/farm/labour/muster", { date: today, entries: [{ workerId: otieno.id, status: "PRESENT" }] });
  check("...and today's muster is now fixed", locked.status === 409, locked.body);
  const del = await call(manager, "DELETE", `/farm/labour/runs/${run.id}`);
  check("a paid run cannot be deleted", del.status === 409, del.body);

  // ── Buyers and credit ──
  const buyers = (await call(manager, "GET", "/farm/sales/buyers")).body;
  const coop = buyers.find((b) => b.kind === "COOP");
  const hotel = buyers.find((b) => b.kind === "HOTEL");
  const school = buyers.find((b) => b.kind === "SCHOOL");
  check("co-op owes 13 days x 20 L x KES 52 less KES 7,280 paid = KES 6,240", coop.owed === 6240, coop);
  check("hotel owes KES 3,780; school KES 4,000", hotel.owed === 3780 && school.owed === 4000, { hotel: hotel.owed, school: school.owed });
  const st = (await call(manager, "GET", `/farm/sales/buyers/${coop.id}/statement`)).body;
  check("the co-op statement closes at KES 6,240 with 13 deliveries and 1 payment", st.closing === 6240 && st.deliveries.length === 13 && st.payments.length === 1, { closing: st.closing, d: st.deliveries.length });

  const settings = (await call(owner, "GET", "/farm/production/settings")).body;
  const stock = async (id) => Number((await call(owner, "GET", `/inventory/items/${settings.branchId}/${id}`)).body?.quantity ?? 0);
  const big = { buyerId: hotel.id, date: today, variantId: settings.eggs.id, quantity: 30, unitPrice: 420 };
  const herdBig = await call(herd, "POST", "/farm/sales/deliveries", big);
  check("going past the hotel's KES 15,000 limit needs a farm manager", herdBig.status === 403 && /limit/.test(herdBig.body.message), herdBig.body);
  const eggs0 = await stock(settings.eggs.id);
  const mgrBig = await call(manager, "POST", "/farm/sales/deliveries", big);
  check("the manager approves it: 30 trays leave stock, owed KES 16,380", mgrBig.status === 201 && mgrBig.body.overLimit === true && mgrBig.body.owed === 16380 && near(await stock(settings.eggs.id), eggs0 - 30), mgrBig.body);

  const milk0 = await stock(settings.milk.id);
  const tooMuch = await call(manager, "POST", "/farm/sales/deliveries", { buyerId: coop.id, date: today, session: "AM", variantId: settings.milk.id, quantity: Math.ceil(milk0) + 50, unitPrice: 52 });
  check("more milk than is fit for sale cannot be delivered", tooMuch.status === 400 && /fit for sale/.test(tooMuch.body.message) && near(await stock(settings.milk.id), milk0), tooMuch.body);
  const ok = await call(herd, "POST", "/farm/sales/deliveries", { buyerId: coop.id, date: today, session: "AM", variantId: settings.milk.id, quantity: 20, slipNo: "UDF-9001" });
  check("20 L to the co-op at the product price, off stock", ok.status === 201 && ok.body.unitPrice === 60 && near(await stock(settings.milk.id), milk0 - 20), ok.body);

  const noRef = await call(manager, "POST", "/farm/sales/payments", { buyerId: coop.id, date: today, amount: 1000, method: "MPESA" });
  check("an M-Pesa payment needs its code", noRef.status === 400, noRef.body);
  const pay = await call(manager, "POST", "/farm/sales/payments", { buyerId: coop.id, date: today, amount: 1000, method: "CASH" });
  check("a payment brings the co-op down to KES 6,440", pay.status === 201 && pay.body.owed === 6440, pay.body);
  check("the herdsman cannot void a payment", (await call(herd, "POST", `/farm/sales/payments/${pay.body.id}/void`, { reason: "wrong buyer" })).status === 403);
  const vd = await call(manager, "POST", `/farm/sales/deliveries/${ok.body.id}/void`, { reason: "co-op rejected it" });
  const coop2 = (await call(manager, "GET", "/farm/sales/buyers")).body.find((b) => b.id === coop.id);
  check("voiding the delivery puts the milk back and takes it off the bill", vd.status === 201 && near(await stock(settings.milk.id), milk0) && coop2.owed === 5240, { owed: coop2.owed });

  // ── The till ──
  const terminals = (await call(owner, "GET", `/terminals?branchId=${settings.branchId}`)).body;
  const term = (Array.isArray(terminals) ? terminals : []).find((t) => t.branchId === settings.branchId);
  const staff = (await call(owner, "GET", "/org-users")).body;
  const mgr = staff.find((u) => u.role === "MANAGER");
  await call(owner, "PATCH", `/org-users/${mgr.id}/pin`, { pin: "4321" });
  const pin = (await call(null, "POST", "/auth/pin-login", { terminalId: term?.id, orgUserId: mgr.id, pin: "4321" })).body;
  const sale = (quantity) =>
    call(pin.accessToken, "POST", "/sales", {
      clientId: crypto.randomUUID(), branchId: settings.branchId, terminalId: term.id, cashierSessionId: pin.cashierSessionId,
      lineItems: [{ variantId: settings.milk.id, quantity }], payments: [{ method: "CASH", amount: quantity * 60 }],
    });
  const milk1 = await stock(settings.milk.id);
  const over = await sale(Math.ceil(milk1) + 10);
  check("the till refuses to sell more milk than is fit for sale", over.status === 400 && /fit for sale/.test(over.body?.message) && near(await stock(settings.milk.id), milk1), over.body);
  const fine = await sale(2);
  check("...but sells 2 L normally", fine.status === 201 && near(await stock(settings.milk.id), milk1 - 2), fine.status);

  // ── Sales by enterprise ──
  const report = (await call(manager, "GET", "/farm/sales/report")).body;
  const dairyRow = report.rows.find((r) => r.name === "Dairy herd");
  const layersRow = report.rows.find((r) => r.name.startsWith("Layers"));
  check("sales by enterprise: dairy has till and co-op sales; layers has egg credit sales", dairyRow?.till >= 120 && dairyRow.credit === 13520 && layersRow?.credit > 0, report.rows);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
