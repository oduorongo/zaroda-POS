// End-to-end check of Shamba F3 (milk, eggs, other produce) against the LOCAL API (port 3001) and the seeded demo farm.
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;
const day = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const near = (a, b) => Math.abs(a - b) < 0.002;

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");
  const vet = await signIn("vet@shamba.demo");
  const today = day();

  const settings = (await call(owner, "GET", "/farm/production/settings")).body;
  check("milk and eggs are linked to POS products", settings.milk?.name === "Fresh milk" && settings.eggs?.name.startsWith("Eggs") && settings.eggsPerUnit === 30, settings);
  const stock = async (variantId) => {
    const r = await call(owner, "GET", `/inventory/items/${settings.branchId}/${variantId}`);
    return Number(r.body?.quantity ?? 0);
  };

  const sheet = (await call(herd, "GET", `/farm/production/milk?date=${today}`)).body;
  const cow = (tag) => sheet.animals.find((a) => a.tag === tag);
  check("the milking sheet lists the cows in milk", !!cow("KC001") && !!cow("KC003"), sheet.animals?.map((a) => a.tag));
  check("KC003 is shown as withheld (treated for mastitis)", !!cow("KC003").withheldUntil, cow("KC003"));

  const again = await call(herd, "POST", "/farm/production/milk", { date: today, session: "AM", entries: [{ animalId: cow("KC001").id, litres: 10, use: "SOLD" }] });
  check("a milking cannot be recorded twice", again.status === 409, again.body);

  const am1 = sheet.records.find((r) => r.animalId === cow("KC001").id && r.session === "AM");
  const herdVoid = await call(herd, "POST", `/farm/production/milk/${am1.id}/void`, { reason: "typed wrong" });
  check("the herdsman cannot void a record", herdVoid.status === 403, herdVoid.body);
  const milkBefore = await stock(settings.milk.id);
  const voided = await call(owner, "POST", `/farm/production/milk/${am1.id}/void`, { reason: "typed wrong" });
  check("voiding takes the milk back out of stock", voided.status === 201 && near(await stock(settings.milk.id), milkBefore - am1.toStock), { before: milkBefore, toStock: am1.toStock });

  const am3 = sheet.records.find((r) => r.animalId === cow("KC003").id && r.session === "AM");
  await call(owner, "POST", `/farm/production/milk/${am3.id}/void`, { reason: "re-enter" });
  const s1 = await stock(settings.milk.id);
  const rec = await call(herd, "POST", "/farm/production/milk", {
    date: today,
    session: "AM",
    entries: [
      { animalId: cow("KC001").id, litres: 10.5, use: "SOLD" },
      { animalId: cow("KC003").id, litres: 7, use: "SOLD" },
    ],
  });
  check("the herdsman records the AM milking", rec.status === 201 && rec.body.saved === 2 && near(rec.body.litres, 17.5), rec.body);
  check("only KC001's milk goes to stock; KC003's is withheld", near(rec.body.toStock, 10.5) && rec.body.withheld.length === 1 && near(await stock(settings.milk.id), s1 + 10.5), rec.body);
  const sheet2 = (await call(owner, "GET", `/farm/production/milk?date=${today}`)).body;
  const kc3 = sheet2.records.find((r) => r.animalId === cow("KC003").id && r.session === "AM");
  check("withheld milk marked for sale is saved as discarded", kc3.withheld === true && kc3.use === "DISCARDED" && kc3.toStock === 0, kc3);

  const future = await call(herd, "POST", "/farm/production/milk", { date: day(1), session: "AM", entries: [{ animalId: cow("KC001").id, litres: 5, use: "SOLD" }] });
  check("tomorrow's milk is refused", future.status === 400, future.body);
  const bull = (await call(owner, "GET", "/farm/animals")).body.find((a) => a.sex === "MALE" && a.species === "CATTLE");
  const bullMilk = await call(owner, "POST", "/farm/production/milk", { date: today, session: "NOON", entries: [{ animalId: bull.id, litres: 2, use: "SOLD" }] });
  check("a male animal cannot be milked", bullMilk.status === 400, bullMilk.body);

  const eggsHerd = (await call(herd, "GET", "/farm/production/eggs")).body;
  check("the herdsman (cow shed and goats only) sees no flocks", eggsHerd.groups.length === 0, eggsHerd.groups);
  const eggs = (await call(owner, "GET", "/farm/production/eggs")).body;
  const flock = eggs.groups.find((g) => g.name === "Layers flock 1");
  check("14 days of egg records with lay %", eggs.records.filter((r) => r.groupId === flock.id).length >= 14 && eggs.records.find((r) => r.groupId === flock.id).layPct > 70, eggs.records.find((r) => r.groupId === flock.id));
  const herdEggs = await call(herd, "POST", "/farm/production/eggs", { groupId: flock.id, date: today, goodEggs: 700 });
  check("...and cannot record eggs for them", herdEggs.status === 403, herdEggs.body);
  const dupEggs = await call(owner, "POST", "/farm/production/eggs", { groupId: flock.id, date: today, goodEggs: 700 });
  check("a flock's day cannot be recorded twice", dupEggs.status === 409, dupEggs.body);

  const todays = eggs.records.find((r) => r.groupId === flock.id && !r.voidedAt && r.date.slice(0, 10) === today);
  await call(owner, "POST", `/farm/production/eggs/${todays.id}/void`, { reason: "count again" });
  const e1 = await stock(settings.eggs.id);
  const headBefore = (await call(owner, "GET", `/farm/groups/${flock.id}`)).body.headCount;
  const laid = await call(owner, "POST", "/farm/production/eggs", { groupId: flock.id, date: today, goodEggs: 780, cracked: 15, small: 9, feedKg: 113, deaths: 2 });
  check("eggs recorded: 26 trays to stock, lay % worked out", laid.status === 201 && near(laid.body.toStock, 26) && near(await stock(settings.eggs.id), e1 + 26) && laid.body.layPct > 80, laid.body);
  const headAfter = (await call(owner, "GET", `/farm/groups/${flock.id}`)).body.headCount;
  check("the 2 deaths come off the flock", headAfter === headBefore - 2, { headBefore, headAfter });

  const drug = (await call(owner, "POST", "/farm/drugs", { name: "Enrofloxacin 10% (test)", milkWithdrawalDays: 0, meatWithdrawalDays: 10, eggWithdrawalDays: 7 })).body;
  const treat = await call(vet, "POST", "/farm/health", { groupId: flock.id, date: today, kind: "TREATED", drugId: drug.id, diagnosis: "CRD", dose: "Drinking water" });
  check("the vet treats the layers: eggs withheld 7 days", treat.status === 201, treat.body);
  await call(owner, "POST", `/farm/production/eggs/${laid.body.id}/void`, { reason: "treated today" });
  check("voiding gives the 2 birds back", (await call(owner, "GET", `/farm/groups/${flock.id}`)).body.headCount === headBefore, null);
  const e2 = await stock(settings.eggs.id);
  const held = await call(owner, "POST", "/farm/production/eggs", { groupId: flock.id, date: today, goodEggs: 760 });
  check("eggs from treated birds are withheld and kept out of stock", held.status === 201 && held.body.withheld === true && held.body.toStock === 0 && near(await stock(settings.eggs.id), e2), held.body);

  const honeyVariant = (await call(owner, "GET", "/products?search=Honey")).body;
  const honeyId = (Array.isArray(honeyVariant) ? honeyVariant : honeyVariant?.items ?? []).flatMap((p) => p.variants ?? []).find((v) => v.sku === "FARM-HONEY")?.id;
  const h1 = honeyId ? await stock(honeyId) : 0;
  const honey = await call(herd, "POST", "/farm/production/produce", { date: today, product: "Honey", quantity: 3.5, unit: "kg", variantId: honeyId });
  check("other produce goes into stock", honey.status === 201 && !!honeyId && near(await stock(honeyId), h1 + 3.5), { status: honey.status, honeyId });
  const manure = await call(herd, "POST", "/farm/production/produce", { date: today, product: "Manure", quantity: 1, unit: "tonne" });
  check("produce with no product is only recorded", manure.status === 201 && manure.body.stockVariantId === null, manure.body);

  const daily = (await call(owner, "GET", "/farm/production/yields?by=day")).body;
  const last = daily.series[daily.series.length - 1];
  check("daily yields: 30 days ending today, with today's milk and eggs", daily.series.length === 30 && last.start === today && last.milk.total > 0 && last.milk.withheld > 0 && last.eggs.total > 0, last);
  check("each cow's milk per day, best first", daily.cows.length >= 3 && daily.cows[0].perDay >= daily.cows[daily.cows.length - 1].perDay, daily.cows);
  const weekly = (await call(owner, "GET", "/farm/production/yields?by=week")).body;
  const monthly = (await call(owner, "GET", "/farm/production/yields?by=month")).body;
  check("weekly (12) and monthly (12) yields", weekly.series.length === 12 && monthly.series.length === 12 && monthly.series[11].milk.total > 0, { w: weekly.series.length, m: monthly.series.length });

  const herdSettings = await call(herd, "PUT", "/farm/production/settings", { eggsPerUnit: 1 });
  check("only a manager changes the produce settings", herdSettings.status === 403, herdSettings.body);
  const badEggs = await call(owner, "PUT", "/farm/production/settings", { eggsPerUnit: 0 });
  check("eggs per unit must be at least 1", badEggs.status === 400, badEggs.body);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
