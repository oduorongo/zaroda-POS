// End-to-end check of Shamba livestock valuation (IAS 41) and livestock in the books, against the LOCAL API (port 3001) and the seeded demo farm.
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
  check("the demo rates are used, with 5% costs to sell", v?.settings?.sellingCost === 0.05 && v.settings.rates.CATTLE.pricePerKg === 280, v?.settings);
  const pendo = v.items.find((i) => i.tag === "KC005");
  check("a bought cow not weighed is at cost: bought price + feed + vet", pendo?.basis === "COST" && pendo.entry === 85000 && Math.abs(pendo.value - pendo.cost) < 0.02, pendo);
  const weighed = v.items.find((i) => i.basis === "MARKET");
  check("a weighed animal is at fair value: weight x price/kg less 5% to sell", weighed && Math.abs(weighed.value - weighed.marketValue * 0.95) < 0.02, weighed);
  const milker = v.items.find((i) => i.produce === "MILK");
  check("milk is income, shown apart: it does not change the value", milker && milker.produceIncome > 0 && Math.abs(milker.profit - (milker.produceIncome + milker.offspringValue + milker.value - milker.cost)) < 0.05, milker);
  const flock = v.items.find((i) => i.kind === "GROUP" && i.produce === "EGGS");
  check("a laying flock is valued per head, with a total for the flock", flock && flock.heads > 0 && Math.abs(flock.total - flock.value * flock.heads) < 1, flock);

  const put = await call(manager, "PUT", "/farm/valuation/settings", { sellingCost: 0.1 });
  check("a manager can change the costs to sell", put.status === 200 && put.body.sellingCost === 0.1, put);
  const after = (await call(manager, "GET", "/farm/valuation")).body.items.find((i) => i.id === weighed.id);
  check("...and fair values follow it", after.value < weighed.value, { before: weighed.value, after: after.value });
  check("a herdsman cannot change rates", (await call(herd, "PUT", "/farm/valuation/settings", { margin: 0.1 })).status === 403);
  check("a bad rate is refused", (await call(manager, "PUT", "/farm/valuation/settings", { rates: [{ species: "CATTLE", birthValue: -1, pricePerKg: 1, primeAgeMonths: 96, ageDropRate: 0.15 }] })).status === 400);
  await call(manager, "PUT", "/farm/valuation/settings", { sellingCost: 0.05 });

  const rep = (await call(owner, "GET", "/farm/reports/valuation")).body;
  check("the valuation report lists every animal and flock with a total", rep?.rows?.length === v.items.length && rep.totals.total > 0, rep?.totals);

  await call(owner, "POST", "/accounting/post-now");
  const total = (await call(manager, "GET", "/farm/valuation")).body.items.reduce((s, i) => s + i.total, 0);
  const bs = (await call(owner, "GET", "/accounting/reports/balance-sheet")).body;
  const ls = bs.assets.find((a) => a.code === "1300");
  check("the books carry the livestock at its value (account 1300)", ls && Math.abs(ls.amount - total) < 1, { books: ls, total });
  check("...and the balance sheet balances", Math.abs(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) < 1, bs);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
