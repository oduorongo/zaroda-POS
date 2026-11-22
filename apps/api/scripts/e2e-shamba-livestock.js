// End-to-end check of Shamba F2 (livestock) against the LOCAL API (port 3001) and the freshly seeded demo farm.
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;
const day = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const vet = await signIn("vet@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");

  // The herdsman works only in the cow shed, calf pens and goat house.
  const units = (await call(owner, "GET", "/farm/units")).body;
  const pens = units.filter((u) => ["Zero-grazing cow shed", "Calf pens", "Goat house"].includes(u.name)).map((u) => u.id);
  const staff = (await call(owner, "GET", "/farm/staff")).body;
  const herdsman = staff.find((p) => p.email === "herdsman@shamba.demo");
  await call(owner, "PUT", `/farm/staff/${herdsman.orgUserId}/roles`, { roles: ["HERDSMAN"], unitIds: pens });

  const ov = (await call(owner, "GET", "/farm/overview")).body;
  check("usage counts head (7 cattle + 3 goats) and birds (950 + 118)", ov.usage.head === 10 && ov.usage.birds === 1068, ov.usage);
  check("dashboard: 1 overdue, 3 due this week (deworming, Newcastle, drying off), 1 in withdrawal", ov.livestock.overdue === 1 && ov.livestock.dueWeek === 3 && ov.livestock.inWithdrawal === 1, ov.livestock);

  const animals = (await call(owner, "GET", "/farm/animals")).body;
  const byTag = Object.fromEntries(animals.map((a) => [a.tag, a]));
  check("10 animals on the farm", animals.length === 10, animals.length);
  check("KC003 is flagged: milk not for sale", !!byTag.KC003.withdrawal.milkUntil && !!byTag.KC003.withdrawal.meatUntil, byTag.KC003.withdrawal);

  const sell = await call(owner, "POST", `/farm/animals/${byTag.KC003.id}/exit`, { status: "SOLD", date: day(), amount: 60000, party: "Butcher" });
  check("a treated cow cannot be sold while meat withdrawal runs", sell.status === 400 && /cannot be sold/.test(sell.body.message), sell.body);

  const herdGroups = (await call(herd, "GET", "/farm/groups")).body;
  check("the herdsman does not see the poultry houses", Array.isArray(herdGroups) && herdGroups.length === 0, herdGroups);
  const groups = (await call(owner, "GET", "/farm/groups")).body;
  const layers = groups.find((g) => g.name === "Layers flock 1");
  const herdLayer = await call(herd, "GET", `/farm/groups/${layers.id}`);
  check("...and cannot open them", herdLayer.status === 403, herdLayer.body);

  const drugs = (await call(owner, "GET", "/farm/drugs")).body;
  const oxy = drugs.find((d) => d.name.startsWith("Oxytetracycline"));
  const albendazole = drugs.find((d) => d.name.startsWith("Albendazole"));
  const herdOxy = await call(herd, "POST", "/farm/health", { animalId: byTag.KC004.id, date: day(), kind: "TREATED", drugId: oxy.id, diagnosis: "Foot rot" });
  check("the herdsman cannot give a prescription-only drug", herdOxy.status === 403, herdOxy.body);
  const vetOxy = await call(vet, "POST", "/farm/health", { animalId: byTag.KC004.id, date: day(), kind: "TREATED", drugId: oxy.id, diagnosis: "Foot rot", dose: "15 ml" });
  check("the vet treats KC004: milk withheld 7 days", vetOxy.status === 201 && vetOxy.body.milkWithdrawalUntil.slice(0, 10) === day(7), vetOxy.body);

  const programmes = (await call(owner, "GET", "/farm/programmes")).body;
  const deworm = programmes.find((p) => p.name === "Deworming");
  const dose = await call(herd, "POST", "/farm/health", { animalId: byTag.KC002.id, date: day(), kind: "DEWORMED", drugId: albendazole.id, programmeId: deworm.id });
  check("the herdsman records the overdue deworming", dose.status === 201, dose.body);
  const kc002 = (await call(owner, "GET", `/farm/animals/${byTag.KC002.id}`)).body;
  check("...which schedules the next dose in 90 days", kc002.due.some((t) => t.programmeId === deworm.id && t.dueOn.slice(0, 10) === day(90)), kc002.due);

  const ai = await call(herd, "POST", "/farm/breeding", { animalId: byTag.KC002.id, date: day(), kind: "AI", sireCode: "KAGRC Ayrshire 104" });
  check("AI on KC002 expects calving in 283 days", ai.status === 201 && ai.body.event.expectedBirth.slice(0, 10) === day(283), ai.body);
  const kc002b = (await call(owner, "GET", `/farm/animals/${byTag.KC002.id}`)).body;
  check("...and schedules drying off 60 days before", kc002b.due.some((t) => t.kind === "DRY_OFF" && t.dueOn.slice(0, 10) === day(223)), kc002b.due);

  const birth = await call(herd, "POST", "/farm/breeding", { animalId: byTag.KC004.id, date: day(), kind: "BIRTH", offspring: [{ tag: "KC008", sex: "FEMALE", name: "Furaha" }] });
  check("a birth registers the calf with its mother", birth.status === 201 && birth.body.young[0].damId === byTag.KC004.id && birth.body.young[0].source === "BORN", birth.body);
  const dupe = await call(herd, "POST", "/farm/animals", { tag: "KC008", species: "CATTLE", sex: "MALE", unitId: pens[0] });
  check("a tag cannot be used twice", dupe.status === 409, dupe.body);
  const goat = await call(herd, "POST", "/farm/animals", { tag: "KG004", species: "GOAT", sex: "FEMALE", breed: "Galla", unitId: pens[2] });
  check("the herdsman adds a goat in the goat house", goat.status === 201, goat.body);
  const outside = await call(herd, "POST", "/farm/animals", { tag: "KG005", species: "GOAT", sex: "FEMALE", unitId: layers.unitId });
  check("...but not in a house outside his work", outside.status === 403, outside.body);

  const died = await call(owner, "POST", `/farm/groups/${layers.id}/counts`, { date: day(), reason: "DIED", count: 5, note: "Found dead" });
  check("5 layers died: flock now 945", died.status === 201 && died.body.headCount === 945, died.body);
  const tooMany = await call(owner, "POST", `/farm/groups/${layers.id}/counts`, { date: day(), reason: "SOLD", count: 2000 });
  check("cannot sell more birds than the flock has", tooMany.status === 400, tooMany.body);
  const huge = await call(owner, "POST", "/farm/groups", { species: "CHICKEN", name: "Broilers 1", placedOn: day(), headCount: 9500 });
  check("a flock over the 10,000-bird Farmer limit is refused with an upgrade", huge.status === 402 && huge.body.upgrade === true, huge.body);

  const goatProg = await call(vet, "POST", "/farm/programmes", { species: "GOAT", name: "PPR vaccination", kind: "VACCINATED", intervalDays: 365 });
  check("the vet adds a goat programme", goatProg.status === 201, goatProg.body);
  const due = (await call(owner, "GET", "/farm/due")).body;
  check("...and every goat (4) gets its first dose due", due.filter((t) => t.programmeId === goatProg.body.id).length === 4, due.length);
  const herdProg = await call(herd, "POST", "/farm/programmes", { species: "GOAT", name: "Sneaky", kind: "DEWORMED", intervalDays: 30 });
  check("the herdsman cannot set programmes", herdProg.status === 403, herdProg.body);

  const kc003 = (await call(owner, "GET", `/farm/animals/${byTag.KC003.id}`)).body;
  const treatment = kc003.health.find((e) => e.drugId === oxy.id);
  const voided = await call(vet, "POST", `/farm/health/${treatment.id}/void`, { reason: "Entered on the wrong cow" });
  check("the vet voids a wrong treatment", voided.status === 201, voided.body);
  const w = (await call(owner, "GET", "/farm/withdrawals")).body;
  check("withdrawal list drops KC003, keeps KC004 (vet) and KC002 (dewormer)", w.length === 2 && !w.some((x) => x.label.startsWith("KC003")), w);

  const ov2 = (await call(owner, "GET", "/farm/overview")).body;
  check("usage now 12 head (calf and goat added), 1063 birds", ov2.usage.head === 12 && ov2.usage.birds === 1063, ov2.usage);

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
