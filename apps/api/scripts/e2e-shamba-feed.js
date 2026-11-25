// End-to-end check of Shamba F5 (feed) against the LOCAL API (port 3001) and the seeded demo farm.
// Changes data: run on a freshly seeded farm.
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

  const settings = (await call(owner, "GET", "/farm/production/settings")).body;
  const products = (await call(owner, "GET", "/products")).body;
  const variant = (sku) => products.flatMap((p) => p.variants).find((v) => v.sku === sku);
  const stock = async (v) => Number((await call(owner, "GET", `/inventory/items/${settings.branchId}/${v.id}`)).body?.quantity ?? 0);
  const [meal, germ, cake, hmash, dap] = ["FEED-DMEAL", "FEED-GERM", "FEED-CAKE", "FEED-HMASH", "FARM-DAP"].map(variant);

  const report = (await call(owner, "GET", "/farm/feed/report")).body;
  const dm = report.feeds.find((f) => f.variantId === meal.id);
  check("dairy meal: 63 kg left at about 10.3 kg a day = 6 days, flagged low", near(dm.onHand, 63) && dm.daysLeft === 6 && dm.low && report.lowFeeds.some((f) => f.variantId === meal.id), dm);
  check("feed cost per litre of milk and per egg are worked out", report.milk.perLitre > 0 && report.eggs.perEgg > 0 && report.milk.litres > 0, { milk: report.milk, eggs: report.eggs });
  check("each fed group and cow has its cost per head per day", report.fed.length >= 5 && report.fed.every((t) => t.costPerHeadPerDay !== null), report.fed.map((t) => [t.label, t.costPerHeadPerDay]));

  const rations = (await call(owner, "GET", "/farm/feed/rations")).body;
  const dairy = rations.find((r) => r.name.startsWith("Dairy meal"));
  check("rations list their ingredients and expected cost per kg", rations.length === 2 && dairy.items.length === 5 && dairy.expectedCostPerKg > 0, dairy);

  const herdRation = await call(herd, "POST", "/farm/feed/rations", { name: "Calf starter", batchKg: 50, items: [{ variantId: germ.id, quantity: 30 }] });
  check("a herdsman cannot make rations", herdRation.status === 403, herdRation.body);
  const bagOut = await call(manager, "POST", "/farm/feed/rations", { name: "Bad", batchKg: 50, outputVariantId: dap.id, items: [{ variantId: germ.id, quantity: 30 }] });
  check("finished feed must be stocked per kg", bagOut.status === 400 && /per kg/.test(bagOut.body.message), bagOut.body);
  const twice = await call(manager, "POST", "/farm/feed/rations", { name: "Twice", batchKg: 50, items: [{ variantId: germ.id, quantity: 30 }, { variantId: germ.id, quantity: 5 }] });
  check("an ingredient cannot be listed twice", twice.status === 400, twice.body);
  const calf = await call(manager, "POST", "/farm/feed/rations", { name: "Calf starter", species: "Cattle", stage: "Calves", batchKg: 50, items: [{ variantId: germ.id, quantity: 30 }, { variantId: cake.id, quantity: 18 }] });
  const calfOut = (await call(owner, "GET", "/products")).body.find((p) => p.name === "Calf starter");
  check("a ration without a feed product gets one, stocked per kg", calf.status === 201 && calfOut?.baseUnit === "kg", { status: calf.status, calfOut });

  const pending = (await call(owner, "GET", "/farm/feed/batches")).body.find((b) => b.status === "PENDING");
  check("the layers batch is waiting for approval", !!pending && pending.batchNo === `FB-${today.replace(/-/g, "")}-1`, pending);
  const herdApprove = await call(herd, "POST", `/farm/feed/batches/${pending.id}/approve`);
  check("only a farm manager approves a batch", herdApprove.status === 403, herdApprove.body);
  const [g0, h0] = [await stock(germ), await stock(hmash)];
  const ok = await call(owner, "POST", `/farm/feed/batches/${pending.id}/approve`);
  check("approving takes 55 kg of maize germ out and puts 88 kg of mash in", ok.status === 201 && near(await stock(germ), g0 - 55) && near(await stock(hmash), h0 + 88), { germ: await stock(germ), mash: await stock(hmash) });
  const hmashV = (await call(owner, "GET", "/products")).body.flatMap((p) => p.variants).find((v) => v.id === hmash.id);
  check("the mash is costed at the batch's actual cost per kg", near(Number(hmashV.cost), ok.body.costPerKg), { cost: hmashV.cost, perKg: ok.body.costPerKg });
  const again = await call(owner, "POST", `/farm/feed/batches/${pending.id}/approve`);
  check("an approved batch cannot be approved again", again.status === 400, again.body);

  const [m1, c1] = [await stock(meal), await stock(cake)];
  const mixed = await call(manager, "POST", "/farm/feed/batches", { rationId: dairy.id, date: today, batches: 2, items: [{ variantId: cake.id, quantity: 40 }], kgProduced: 138 });
  check("the miller's batch is recorded as pending, nothing moves yet", mixed.status === 201 && mixed.body.status === "PENDING" && near(await stock(meal), m1) && near(await stock(cake), c1), mixed.body);
  const batches = (await call(owner, "GET", "/farm/feed/batches")).body;
  const mine = batches.find((b) => b.id === mixed.body.id);
  check("it used twice the recipe, with the cake changed to 40 kg, as batch -2", mine.batchNo.endsWith("-2") && mine.items.find((i) => i.name === "Sunflower cake").quantity === 40 && mine.items.find((i) => i.name === "Maize germ").quantity === 84, mine);
  await call(manager, "POST", `/farm/feed/batches/${mixed.body.id}/approve`);
  check("approved: 138 kg of dairy meal in, 40 kg of cake out", near(await stock(meal), m1 + 138) && near(await stock(cake), c1 - 40), { meal: await stock(meal), cake: await stock(cake) });
  const rev = await call(manager, "POST", `/farm/feed/batches/${mixed.body.id}/reverse`, { reason: "weighed wrong" });
  check("reversing an approved batch puts it all back", rev.status === 201 && near(await stock(meal), m1) && near(await stock(cake), c1), { meal: await stock(meal), cake: await stock(cake) });

  const rej = (await call(manager, "POST", "/farm/feed/batches", { rationId: dairy.id, date: today, kgProduced: 69 })).body;
  const g1 = await stock(germ);
  const turned = await call(manager, "POST", `/farm/feed/batches/${rej.id}/reverse`, { reason: "not mixed after all" });
  check("turning down a pending batch moves no stock", turned.status === 201 && turned.body.status === "REVERSED" && near(await stock(germ), g1), turned.body);

  const animals = (await call(owner, "GET", "/farm/animals")).body;
  const kc1 = animals.find((a) => a.tag === "KC001");
  const m2 = await stock(meal);
  const fed = await call(herd, "POST", "/farm/feed/feedings", { date: today, entries: [{ animalId: kc1.id, variantId: meal.id, kg: 4.5 }] });
  check("the herdsman feeds KC001 4.5 kg of dairy meal, off stock at its cost", fed.status === 201 && near(await stock(meal), m2 - 4.5) && fed.body.cost > 0, fed.body);
  const groups = (await call(owner, "GET", "/farm/groups")).body;
  const layersFlock = groups.find((g) => g.name === "Layers flock 1");
  const outside = await call(herd, "POST", "/farm/feed/feedings", { date: today, entries: [{ groupId: layersFlock.id, variantId: variant("FEED-LMASH").id, kg: 110 }] });
  check("the herdsman cannot feed a flock outside their sheds", outside.status === 403, outside.body);
  const bags = await call(manager, "POST", "/farm/feed/feedings", { date: today, entries: [{ animalId: kc1.id, variantId: dap.id, kg: 1 }] });
  check("feed must be a per-kg stock item", bags.status === 400, bags.body);
  const future = await call(manager, "POST", "/farm/feed/feedings", { date: day(1), entries: [{ animalId: kc1.id, variantId: meal.id, kg: 4 }] });
  check("tomorrow's feeding is refused", future.status === 400, future.body);

  const list = (await call(manager, "GET", "/farm/feed/feedings")).body;
  const row = list.records.find((r) => r.animalId === kc1.id && r.date.slice(0, 10) === today && r.kg === 4.5);
  const m3 = await stock(meal);
  const v = await call(manager, "POST", `/farm/feed/feedings/${row.id}/void`, { reason: "fed twice" });
  check("voiding a feeding puts the feed back", v.status === 201 && near(await stock(meal), m3 + 4.5), v.body);
  check("the herdsman cannot void", (await call(herd, "POST", `/farm/feed/feedings/${row.id}/void`, { reason: "x x x" })).status === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
