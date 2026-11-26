// End-to-end check of Shamba animal valuation against the LOCAL API (port 3001) and the seeded demo farm.
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + String(JSON.stringify(detail)).slice(0, 400)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const manager = await signIn("manager@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");

  check("a herdsman cannot see valuations", (await call(herd, "GET", "/farm/valuation")).status === 403);
  const v = (await call(manager, "GET", "/farm/valuation")).body;
  check("the demo rates and 25% margin are used", v?.settings?.margin === 0.25 && v.settings.rates.CATTLE.pricePerKg === 280, v?.settings);
  const pendo = v.items.find((i) => i.tag === "KC005");
  check("a bought cow starts from its bought price (KES 85,000)", pendo?.entry === 85000, pendo);
  check("...cost is bought + feed + vet, and cost + 25% follows", pendo && Math.abs(pendo.cost - (pendo.entry + pendo.feed + pendo.vet)) < 0.02 && Math.abs(pendo.costPrice - pendo.cost * 1.25) < 0.02, pendo);
  check("...the suggested price is in round 50s and at least cost + margin or weight value", pendo && pendo.suggested % 50 === 0 && pendo.suggested >= Math.min(pendo.costPrice, pendo.weightValue ?? Infinity) - 50, pendo);
  const milker = v.items.find((i) => i.produce === "MILK");
  check("a milking cow carries a production value", milker && milker.productionValue > 0, milker);
  const flock = v.items.find((i) => i.kind === "GROUP" && i.produce === "EGGS");
  check("a laying flock is priced per head, with eggs adding value and a total for the flock", flock && flock.heads > 0 && flock.productionValue > 0 && Math.abs(flock.total - flock.suggested * flock.heads) < 0.01, flock);

  const before = pendo.suggested;
  const put = await call(manager, "PUT", "/farm/valuation/settings", { margin: 0.5 });
  check("a manager can change the margin", put.status === 200 && put.body.margin === 0.5, put);
  const after = (await call(manager, "GET", "/farm/valuation")).body.items.find((i) => i.tag === "KC005");
  check("...and prices follow it", after.costPrice > pendo.costPrice && after.suggested >= before, { before: pendo, after });
  check("an auditor-free herdsman cannot change rates", (await call(herd, "PUT", "/farm/valuation/settings", { margin: 0.1 })).status === 403);
  check("a bad rate is refused", (await call(manager, "PUT", "/farm/valuation/settings", { rates: [{ species: "CATTLE", birthValue: -1, pricePerKg: 1, primeAgeMonths: 96, ageDropRate: 0.15 }] })).status === 400);
  await call(manager, "PUT", "/farm/valuation/settings", { margin: 0.25 });

  const rep = (await call(owner, "GET", "/farm/reports/valuation")).body;
  check("the valuation report lists every animal and flock with a total", rep?.rows?.length === v.items.length && rep.totals.total > 0, rep?.totals);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
