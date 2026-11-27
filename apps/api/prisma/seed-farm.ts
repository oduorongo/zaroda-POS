import { FarmEnterpriseKind, FarmRoleCode, FarmUnitKind, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { FarmSetupService } from "../src/farm/farm-setup.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addDays, asDate, todayKey } from "../src/farm/farm-livestock.util";
import { batchCost, batchNo as batchNoFor } from "../src/farm/farm-feed.util";

/**
 * Zaroda Shamba demo farm (docs/farm): "Uriri Dairy & Poultry Farm" with its staff, layout and enterprises.
 * Safe to re-run: an existing demo farm is left as it is. Run: pnpm --filter api seed:farm
 * Sign in at /login as owner@shamba.demo with DEMO_PASSWORD (default password123; set your own on a live database).
 */
const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: "Uriri Dairy & Poultry Farm", industryType: "FARM" } });
  if (existing) {
    await seedLivestock(existing.id);
    await seedProduction(existing.id);
    await seedCrops(existing.id);
    await seedFeed(existing.id);
    await seedLabourSales(existing.id);
    await seedValuation(existing.id);
    await seedInputs(existing.id);
    return;
  }
  const orgId = randomUUID();
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || "password123", 10);
  const staff: { email: string; fullName: string; role: Role; farm: FarmRoleCode[] }[] = [
    { email: "owner@shamba.demo", fullName: "Grace Akinyi", role: Role.OWNER, farm: [FarmRoleCode.FARM_OWNER] },
    { email: "manager@shamba.demo", fullName: "Peter Ochieng", role: Role.MANAGER, farm: [FarmRoleCode.FARM_MANAGER] },
    { email: "herdsman@shamba.demo", fullName: "Joseph Omondi", role: Role.SUPERVISOR, farm: [FarmRoleCode.HERDSMAN] },
    { email: "vet@shamba.demo", fullName: "Dr. Mercy Atieno", role: Role.SUPERVISOR, farm: [FarmRoleCode.VET] },
  ];

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      await tx.organization.create({
        data: { id: orgId, name: "Uriri Dairy & Poultry Farm", industryType: "FARM", country: "KE", baseCurrency: "KES", phone: "0700000001", email: "info@shamba.demo" },
      });
      const branch = await tx.branch.create({ data: { organizationId: orgId, name: "Main farm", county: "Migori", subCounty: "Uriri" } });
      await tx.terminal.create({ data: { branchId: branch.id, deviceLabel: "Farm gate till" } });

      const orgUsers: Record<string, string> = {};
      for (const s of staff) {
        const user = await tx.user.create({ data: { email: s.email, fullName: s.fullName, passwordHash: hash } });
        const ou = await tx.orgUser.create({ data: { organizationId: orgId, userId: user.id, role: s.role } });
        orgUsers[s.email] = ou.id;
      }

      await new FarmSetupService(prisma as unknown as PrismaService).ensure(tx, orgId);
      await tx.farmSettings.update({ where: { organizationId: orgId }, data: { county: "Migori", subCounty: "Uriri", ward: "Central Kanyamkago" } });
      await tx.farmSubscription.update({ where: { organizationId: orgId }, data: { planCode: "FARM_FARMER", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });

      const unit = (kind: FarmUnitKind, name: string, extra: { parentId?: string; acres?: number; capacity?: number; code?: string } = {}) =>
        tx.farmUnit.create({ data: { organizationId: orgId, branchId: branch.id, kind, name, ...extra } });
      const blockA = await unit(FarmUnitKind.BLOCK, "Block A (lower)", { code: "A" });
      const blockB = await unit(FarmUnitKind.BLOCK, "Block B (upper)", { code: "B" });
      const napier = await unit(FarmUnitKind.FIELD, "Napier field", { parentId: blockA.id, acres: 3, code: "A1" });
      const maize = await unit(FarmUnitKind.FIELD, "Maize field", { parentId: blockB.id, acres: 6, code: "B1" });
      const beans = await unit(FarmUnitKind.FIELD, "Beans field", { parentId: blockB.id, acres: 2, code: "B2" });
      const paddock = await unit(FarmUnitKind.PADDOCK, "Grazing paddock", { parentId: blockA.id, acres: 4, capacity: 30, code: "A2" });
      const cowShed = await unit(FarmUnitKind.PEN, "Zero-grazing cow shed", { parentId: blockA.id, capacity: 20, code: "CS" });
      const calfPen = await unit(FarmUnitKind.PEN, "Calf pens", { parentId: blockA.id, capacity: 8 });
      const goatHouse = await unit(FarmUnitKind.PEN, "Goat house", { capacity: 25 });
      const layers = await unit(FarmUnitKind.POULTRY_HOUSE, "Layers house 1", { capacity: 1000, code: "L1" });
      const kienyeji = await unit(FarmUnitKind.POULTRY_HOUSE, "Kienyeji run", { capacity: 300 });
      const store = await unit(FarmUnitKind.STORE, "Feed and drug store");
      const mill = await unit(FarmUnitKind.FEED_MILL, "Feed mixing room");

      const ent = (kind: FarmEnterpriseKind, name: string, unitIds: string[]) => tx.farmEnterprise.create({ data: { organizationId: orgId, kind, name, unitIds } });
      await ent(FarmEnterpriseKind.DAIRY, "Dairy herd", [cowShed.id, calfPen.id, paddock.id, napier.id]);
      await ent(FarmEnterpriseKind.LAYERS, "Layers (Isa Brown)", [layers.id]);
      await ent(FarmEnterpriseKind.KIENYEJI, "Improved kienyeji", [kienyeji.id]);
      await ent(FarmEnterpriseKind.GOATS, "Dairy goats", [goatHouse.id]);
      await ent(FarmEnterpriseKind.CROP, "Maize long rains", [maize.id]);
      await ent(FarmEnterpriseKind.CROP, "Beans", [beans.id]);
      await ent(FarmEnterpriseKind.FEED, "Feed mixing", [mill.id, store.id]);

      for (const s of staff) {
        await tx.farmUserRole.createMany({
          data: s.farm.map((role) => ({ organizationId: orgId, orgUserId: orgUsers[s.email], role, unitIds: role === FarmRoleCode.HERDSMAN ? [cowShed.id, calfPen.id, goatHouse.id] : [] })),
          skipDuplicates: true,
        });
      }
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  await seedLivestock(orgId);
  await seedProduction(orgId);
  await seedCrops(orgId);
  await seedFeed(orgId);
  await seedLabourSales(orgId);
  await seedValuation(orgId);
  await seedInputs(orgId);
  console.log("Seeded the demo farm. Sign in at /login as owner@shamba.demo and the DEMO_PASSWORD (default password123).");
}

/** F2: herd, flocks, drugs, programmes, a treatment still in withdrawal and a cow in calf. Skipped once the farm has animals. */
async function seedLivestock(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.farmAnimal.count({ where: { organizationId: orgId } })) {
        console.log("The demo farm already has its animals - nothing to do.");
        return;
      }
      const today = todayKey();
      const ago = (n: number) => addDays(today, -n);
      const unitId = async (name: string) => (await tx.farmUnit.findFirst({ where: { organizationId: orgId, name } }))?.id ?? null;
      const entId = async (name: string) => (await tx.farmEnterprise.findFirst({ where: { organizationId: orgId, name } }))?.id ?? null;
      const [cowShed, calfPen, goatHouse, layersHouse, kienyejiRun, dairy, goats, layers, kienyeji] = await Promise.all([
        unitId("Zero-grazing cow shed"),
        unitId("Calf pens"),
        unitId("Goat house"),
        unitId("Layers house 1"),
        unitId("Kienyeji run"),
        entId("Dairy herd"),
        entId("Dairy goats"),
        entId("Layers (Isa Brown)"),
        entId("Improved kienyeji"),
      ]);

      const drug = (name: string, milk: number, meat: number, egg: number, prescriptionOnly = false) =>
        tx.farmDrug.create({ data: { organizationId: orgId, name, milkWithdrawalDays: milk, meatWithdrawalDays: meat, eggWithdrawalDays: egg, prescriptionOnly } });
      const oxy = await drug("Oxytetracycline 20% LA", 7, 28, 0, true);
      const albendazole = await drug("Albendazole 10% drench", 3, 14, 0);
      const fmd = await drug("FMD vaccine (KEVEVAPI)", 0, 0, 0);
      const lasota = await drug("Newcastle vaccine (Lasota)", 0, 0, 0);
      await drug("Amprolium 20%", 0, 7, 7);

      const programme = (species: "CATTLE" | "CHICKEN", name: string, kind: "VACCINATED" | "DEWORMED", drugId: string, firstAgeDays: number, intervalDays: number) =>
        tx.farmProgramme.create({ data: { organizationId: orgId, species, name, kind, drugId, firstAgeDays, intervalDays } });
      const fmdP = await programme("CATTLE", "FMD vaccination", "VACCINATED", fmd.id, 120, 180);
      const dewormP = await programme("CATTLE", "Deworming", "DEWORMED", albendazole.id, 60, 90);
      const ncdP = await programme("CHICKEN", "Newcastle booster", "VACCINATED", lasota.id, 21, 90);

      const cow = (tag: string, name: string, breed: string, sex: "FEMALE" | "MALE", born: string, extra: Record<string, unknown> = {}) =>
        tx.farmAnimal.create({
          data: { organizationId: orgId, tag, name, species: "CATTLE", breed, sex, birthDate: asDate(born), source: "BOUGHT", unitId: cowShed, enterpriseId: dairy, ...extra },
        });
      const neema = await cow("KC001", "Neema", "Friesian", "FEMALE", ago(5 * 365));
      const baraka = await cow("KC002", "Baraka", "Ayrshire", "FEMALE", ago(4 * 365));
      const zawadi = await cow("KC003", "Zawadi", "Friesian x Ayrshire", "FEMALE", ago(3 * 365 + 40));
      await cow("KC004", "Imani", "Jersey", "FEMALE", ago(6 * 365));
      await cow("KC005", "Pendo", "Friesian", "FEMALE", ago(2 * 365), { boughtOn: asDate(ago(200)), boughtPrice: 85000 });
      const calf1 = await cow("KC006", "Tumaini", "Friesian", "FEMALE", ago(95), { source: "BORN", damId: neema.id, sireCode: "ABS Friesian 29HO", unitId: calfPen });
      const calf2 = await cow("KC007", "Jabali", "Ayrshire", "MALE", ago(40), { source: "BORN", damId: baraka.id, sireCode: "KAGRC Ayrshire 104", unitId: calfPen });

      const goat = (tag: string, name: string, breed: string, sex: "FEMALE" | "MALE", born: string) =>
        tx.farmAnimal.create({ data: { organizationId: orgId, tag, name, species: "GOAT", breed, sex, birthDate: asDate(born), source: "BOUGHT", unitId: goatHouse, enterpriseId: goats } });
      await goat("KG001", "Saida", "Toggenburg", "FEMALE", ago(3 * 365));
      await goat("KG002", "Malkia", "Saanen", "FEMALE", ago(2 * 365));
      await goat("KG003", "Simba", "Alpine", "MALE", ago(2 * 365 + 100));

      const layerFlock = await tx.farmGroup.create({
        data: { organizationId: orgId, species: "CHICKEN", name: "Layers flock 1", breed: "Isa Brown", purpose: "Eggs", placedOn: asDate(ago(150)), headCount: 950, unitId: layersHouse, enterpriseId: layers },
      });
      const kienyejiFlock = await tx.farmGroup.create({
        data: { organizationId: orgId, species: "CHICKEN", name: "Kienyeji flock", breed: "Improved Kienyeji (Kuroiler)", purpose: "Eggs and meat", placedOn: asDate(ago(70)), headCount: 118, unitId: kienyejiRun, enterpriseId: kienyeji },
      });
      await tx.farmGroupCount.createMany({
        data: [
          { organizationId: orgId, groupId: layerFlock.id, date: asDate(ago(150)), change: 1000, reason: "PLACED", note: "Point-of-lay pullets" },
          { organizationId: orgId, groupId: layerFlock.id, date: asDate(ago(60)), change: -50, reason: "DIED", note: "Heat stress" },
          { organizationId: orgId, groupId: kienyejiFlock.id, date: asDate(ago(70)), change: 120, reason: "PLACED" },
          { organizationId: orgId, groupId: kienyejiFlock.id, date: asDate(ago(20)), change: -2, reason: "DIED" },
        ],
      });

      const treatedOn = ago(2);
      await tx.farmHealthEvent.create({
        data: {
          organizationId: orgId,
          animalId: zawadi.id,
          date: asDate(treatedOn),
          kind: "TREATED",
          diagnosis: "Mastitis (front left quarter)",
          drugId: oxy.id,
          dose: "20 ml IM",
          vetName: "Dr. Mercy Atieno",
          cost: 1500,
          milkWithdrawalUntil: asDate(addDays(treatedOn, 7)),
          meatWithdrawalUntil: asDate(addDays(treatedOn, 28)),
        },
      });
      await tx.farmHealthEvent.create({ data: { organizationId: orgId, groupId: layerFlock.id, date: asDate(ago(80)), kind: "VACCINATED", drugId: lasota.id, programmeId: ncdP.id, dose: "Drinking water" } });

      const served = ago(220);
      const calving = addDays(served, 283);
      await tx.farmBreedingEvent.create({ data: { organizationId: orgId, animalId: neema.id, date: asDate(served), kind: "AI", sireCode: "ABS Friesian 29HO", inseminator: "KAGRC technician", expectedBirth: asDate(calving) } });
      await tx.farmBreedingEvent.create({ data: { organizationId: orgId, animalId: neema.id, date: asDate(addDays(served, 90)), kind: "PD_POSITIVE" } });
      await tx.farmWeight.createMany({
        data: [
          { organizationId: orgId, animalId: calf1.id, date: asDate(ago(95)), kg: 38 },
          { organizationId: orgId, animalId: calf1.id, date: asDate(ago(30)), kg: 92 },
          { organizationId: orgId, animalId: calf2.id, date: asDate(ago(40)), kg: 34 },
        ],
      });

      const task = (who: { animalId?: string; groupId?: string }, kind: string, title: string, dueOn: string, programmeId: string | null = null) => ({
        organizationId: orgId,
        ...who,
        kind,
        title,
        dueOn: asDate(dueOn),
        programmeId,
      });
      await tx.farmDueTask.createMany({
        data: [
          task({ animalId: neema.id }, "EXPECTED_BIRTH", "KC001 due to give birth", calving),
          task({ animalId: neema.id }, "DRY_OFF", "Dry off KC001", addDays(calving, -60)),
          task({ animalId: baraka.id }, "DEWORMED", "Deworming: KC002", ago(3), dewormP.id),
          task({ animalId: zawadi.id }, "DEWORMED", "Deworming: KC003", addDays(today, 3), dewormP.id),
          task({ animalId: neema.id }, "VACCINATED", "FMD vaccination: KC001", addDays(today, 10), fmdP.id),
          task({ animalId: calf1.id }, "VACCINATED", "FMD vaccination: KC006", addDays(today, 25), fmdP.id),
          task({ groupId: layerFlock.id }, "VACCINATED", "Newcastle booster: Layers flock 1", addDays(today, 10), ncdP.id),
          task({ groupId: kienyejiFlock.id }, "VACCINATED", "Newcastle booster: Kienyeji flock", today, ncdP.id),
        ],
      });
      console.log("Seeded the demo farm's animals, flocks, drugs and programmes.");
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/** F3: milk and egg products in stock, two weeks of milkings and egg records (the treated cow's milk withheld), and some honey. */
async function seedProduction(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.farmMilkRecord.count({ where: { organizationId: orgId } })) {
        console.log("The demo farm already has milk records - nothing to do.");
        return;
      }
      const branch = await tx.branch.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
      const cows = await tx.farmAnimal.findMany({ where: { organizationId: orgId, tag: { in: ["KC001", "KC002", "KC003"] } }, orderBy: { tag: "asc" } });
      const flocks = await tx.farmGroup.findMany({ where: { organizationId: orgId, species: "CHICKEN" }, orderBy: { name: "desc" } });
      const treated = await tx.farmHealthEvent.findFirst({ where: { organizationId: orgId, milkWithdrawalUntil: { not: null } }, orderBy: { date: "desc" } });
      if (!branch || cows.length < 3) return;

      const product = (name: string, unit: string, sku: string, price: number) =>
        tx.product.create({ data: { organizationId: orgId, name, baseUnit: unit, variants: { create: { sku, price, quantityMode: "WEIGHT" } } }, include: { variants: true } });
      const milk = (await product("Fresh milk", "litre", "FARM-MILK", 60)).variants[0].id;
      const eggs = (await product("Eggs (tray of 30)", "tray", "FARM-EGGS", 450)).variants[0].id;
      const honey = (await product("Honey", "kg", "FARM-HONEY", 900)).variants[0].id;
      await tx.farmProduceSettings.create({ data: { organizationId: orgId, milkVariantId: milk, eggVariantId: eggs, eggsPerUnit: 30, branchId: branch.id } });

      const stock: Record<string, number> = {};
      const toStock = async (variantId: string, qty: number, referenceId: string) => {
        const q = Math.round(qty * 1000) / 1000;
        await tx.inventoryTransaction.create({ data: { branchId: branch.id, variantId, type: "PRODUCTION", quantityDelta: q, referenceId } });
        stock[variantId] = (stock[variantId] ?? 0) + q;
      };

      const today = todayKey();
      const yieldOf: Record<string, [number, number]> = { KC001: [11, 9], KC002: [9.5, 8], KC003: [8, 7] };
      for (let i = 13; i >= 0; i--) {
        const day = addDays(today, -i);
        for (const c of cows) {
          const held = !!treated && treated.animalId === c.id && day >= dayKey(treated.date) && day < dayKey(treated.milkWithdrawalUntil!);
          for (const [k, session] of (["AM", "PM"] as const).entries()) {
            const litres = Math.round((yieldOf[c.tag][k] + ((i * 7 + k) % 5) * 0.3 - 0.6) * 10) / 10;
            const use = held ? "DISCARDED" : c.tag === "KC002" && session === "PM" && i % 3 === 0 ? "CALVES" : "SOLD";
            const sold = use === "SOLD";
            const rec = await tx.farmMilkRecord.create({
              data: { organizationId: orgId, animalId: c.id, date: asDate(day), session, litres, withheld: held, use, toStock: sold ? litres : 0, stockVariantId: sold ? milk : null, stockBranchId: sold ? branch.id : null },
            });
            if (sold) await toStock(milk, litres, rec.id);
          }
        }
        for (const f of flocks) {
          const big = f.headCount > 500;
          const good = big ? 760 + ((i * 13) % 40) : 52 + ((i * 5) % 12);
          const rec = await tx.farmEggRecord.create({
            data: {
              organizationId: orgId, groupId: f.id, date: asDate(day), birds: f.headCount, goodEggs: good, cracked: big ? 12 + (i % 4) : 2, small: big ? 8 : 3,
              feedKg: big ? 112 : 14, deaths: 0, toStock: Math.round((good / 30) * 1000) / 1000, stockVariantId: eggs, stockBranchId: branch.id,
            },
          });
          await toStock(eggs, good / 30, rec.id);
        }
      }
      const honeyRec = await tx.farmProduceRecord.create({
        data: { organizationId: orgId, date: asDate(addDays(today, -5)), product: "Honey", quantity: 12, unit: "kg", note: "Hives behind the maize field", stockVariantId: honey, stockBranchId: branch.id },
      });
      await toStock(honey, 12, honeyRec.id);
      await tx.farmProduceRecord.create({ data: { organizationId: orgId, date: asDate(addDays(today, -3)), product: "Cow manure", quantity: 2, unit: "tonnes", note: "Spread on the napier field" } });
      for (const [variantId, quantity] of Object.entries(stock)) {
        await tx.inventoryItem.create({ data: { branchId: branch.id, variantId, quantity: Math.round(quantity * 1000) / 1000 } });
      }
      console.log("Seeded the demo farm's milk, eggs and honey, with the produce in stock.");
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/** F4: inputs in stock, a maize season sprayed 5 days ago (harvest still blocked) and a bean season harvested into stock. */
async function seedCrops(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.farmCropSeason.count({ where: { organizationId: orgId } })) {
        console.log("The demo farm already has crop seasons - nothing to do.");
        return;
      }
      const branch = await tx.branch.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
      const unit = async (name: string) => tx.farmUnit.findFirst({ where: { organizationId: orgId, name } });
      const [maizeField, beansField] = [await unit("Maize field"), await unit("Beans field")];
      const ent = async (name: string) => (await tx.farmEnterprise.findFirst({ where: { organizationId: orgId, name } }))?.id ?? null;
      if (!branch || !maizeField || !beansField) return;

      const stock: Record<string, number> = {};
      const move = async (variantId: string, qty: number, type: "RECEIPT" | "PRODUCTION", referenceId?: string) => {
        await tx.inventoryTransaction.create({ data: { branchId: branch.id, variantId, type, quantityDelta: qty, referenceId } });
        stock[variantId] = (stock[variantId] ?? 0) + qty;
      };
      const product = async (name: string, unitName: string, sku: string, price: number, cost: number, mode: "COUNT" | "WEIGHT") =>
        (await tx.product.create({ data: { organizationId: orgId, name, baseUnit: unitName, variants: { create: { sku, price, cost, quantityMode: mode } } }, include: { variants: true } })).variants[0].id;
      const dap = await product("DAP fertiliser (50 kg bag)", "bag", "FARM-DAP", 4200, 3500, "COUNT");
      const can = await product("CAN fertiliser (50 kg bag)", "bag", "FARM-CAN", 3800, 3200, "COUNT");
      const duduthrin = await product("Duduthrin 1.75 EC", "litre", "FARM-DUDU", 1500, 1200, "WEIGHT");
      const beans = await product("Dry beans", "kg", "FARM-BEANS", 140, 0, "WEIGHT");
      await move(dap, 20, "RECEIPT");
      await move(can, 15, "RECEIPT");
      await move(duduthrin, 5, "RECEIPT");

      const today = todayKey();
      const ago = (n: number) => addDays(today, -n);
      const maize = await tx.farmCropSeason.create({
        data: {
          organizationId: orgId, unitId: maizeField.id, enterpriseId: await ent("Maize long rains"), crop: "Maize", variety: "H614D", acres: 6,
          plantedOn: asDate(ago(110)), expectedHarvest: asDate(addDays(today, 30)), status: "GROWING", seedSupplier: "Kenya Seed Company", seedCertNo: "KSC-H614-2026-0412",
        },
      });
      const act = async (seasonId: string, n: number, kind: string, extra: Record<string, unknown> = {}) =>
        tx.farmCropActivity.create({ data: { organizationId: orgId, seasonId, date: asDate(ago(n)), kind: kind as never, ...extra } });
      await act(maize.id, 120, "LAND_PREP", { workers: 4, labourCost: 6000, notes: "Ploughed and harrowed with hired tractor" });
      const planted = await act(maize.id, 110, "PLANTING", { product: "DAP at planting", inputVariantId: dap, quantity: 6, stockBranchId: branch.id, inputCost: 21000, workers: 6, labourCost: 4800 });
      await move(dap, -6, "PRODUCTION", planted.id);
      await act(maize.id, 80, "WEEDING", { workers: 8, labourCost: 6400 });
      const topped = await act(maize.id, 70, "TOP_DRESSING", { product: "CAN", inputVariantId: can, quantity: 6, stockBranchId: branch.id, inputCost: 19200, workers: 4, labourCost: 2000 });
      await move(can, -6, "PRODUCTION", topped.id);
      const sprayDay = ago(5);
      const sprayed = await act(maize.id, 5, "SPRAYING", {
        product: "Duduthrin 1.75 EC", rate: "40 ml per 20 L knapsack", inputVariantId: duduthrin, quantity: 1, stockBranchId: branch.id, inputCost: 1200,
        workers: 2, labourCost: 1000, preHarvestDays: 14, safeHarvestFrom: asDate(addDays(sprayDay, 14)), doneBy: "Joseph Omondi", notes: "Fall armyworm",
      });
      await move(duduthrin, -1, "PRODUCTION", sprayed.id);

      const beanSeason = await tx.farmCropSeason.create({
        data: {
          organizationId: orgId, unitId: beansField.id, enterpriseId: await ent("Beans"), crop: "Beans", variety: "Rosecoco (GLP 2)", acres: 2,
          plantedOn: asDate(ago(100)), expectedHarvest: asDate(ago(10)), status: "HARVESTING", seedSupplier: "Simlaw Seeds", seedCertNo: "SIM-GLP2-2026-118",
        },
      });
      await act(beanSeason.id, 102, "LAND_PREP", { workers: 3, labourCost: 3000 });
      const bp = await act(beanSeason.id, 100, "PLANTING", { product: "DAP at planting", inputVariantId: dap, quantity: 2, stockBranchId: branch.id, inputCost: 7000, workers: 4, labourCost: 2400 });
      await move(dap, -2, "PRODUCTION", bp.id);
      await act(beanSeason.id, 70, "WEEDING", { workers: 4, labourCost: 2400 });
      const harvest = await tx.farmHarvest.create({
        data: { organizationId: orgId, seasonId: beanSeason.id, date: asDate(ago(8)), quantity: 8, unit: "bag (90 kg)", kgPerUnit: 90, kg: 720, grade: "Grade 1", stockVariantId: beans, stockBranchId: branch.id },
      });
      await move(beans, 720, "PRODUCTION", harvest.id);

      for (const [variantId, quantity] of Object.entries(stock)) {
        await tx.inventoryItem.create({ data: { branchId: branch.id, variantId, quantity } });
      }
      console.log("Seeded the demo farm's crops: maize (sprayed, harvest blocked for 9 more days) and beans (720 kg harvested into stock).");
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/** F5: ingredients, a dairy meal ration mixed and approved 12 days ago and fed to the cows (now running low), bought layers mash fed to the flocks, and a layers batch waiting for approval. */
async function seedFeed(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.farmRation.count({ where: { organizationId: orgId } })) {
        console.log("The demo farm already has rations - nothing to do.");
        return;
      }
      const branch = await tx.branch.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
      const cows = await tx.farmAnimal.findMany({ where: { organizationId: orgId, tag: { in: ["KC001", "KC002", "KC003"] } }, orderBy: { tag: "asc" } });
      const flocks = await tx.farmGroup.findMany({ where: { organizationId: orgId, species: "CHICKEN" }, orderBy: { name: "desc" } });
      const owner = await tx.orgUser.findFirst({ where: { organizationId: orgId, role: "OWNER" } });
      const manager = await tx.orgUser.findFirst({ where: { organizationId: orgId, role: "MANAGER" } });
      if (!branch || cows.length < 3) return;

      const stock: Record<string, number> = {};
      const costs: Record<string, number> = {};
      const move = async (variantId: string, qty: number, type: "RECEIPT" | "PRODUCTION", referenceId?: string) => {
        await tx.inventoryTransaction.create({ data: { branchId: branch.id, variantId, type, quantityDelta: Math.round(qty * 1000) / 1000, referenceId } });
        stock[variantId] = (stock[variantId] ?? 0) + qty;
      };
      const perKg = async (name: string, sku: string, cost: number, price = 0) => {
        const id = (await tx.product.create({ data: { organizationId: orgId, name, baseUnit: "kg", variants: { create: { sku, price, cost, quantityMode: "WEIGHT" } } }, include: { variants: true } })).variants[0].id;
        costs[id] = cost;
        return id;
      };
      const germ = await perKg("Maize germ", "FEED-GERM", 32);
      const cake = await perKg("Sunflower cake", "FEED-CAKE", 45);
      const omena = await perKg("Fish meal (omena)", "FEED-OMENA", 120);
      const dcp = await perKg("DCP (dicalcium phosphate)", "FEED-DCP", 90);
      const dPremix = await perKg("Dairy premix", "FEED-DPREMIX", 250);
      const lPremix = await perKg("Layers premix", "FEED-LPREMIX", 260);
      const lime = await perKg("Limestone", "FEED-LIME", 15);
      const boughtMash = await perKg("Layers mash (bought)", "FEED-LMASH", 58, 65);
      for (const [v, q] of [[germ, 500], [cake, 300], [omena, 60], [dcp, 40], [dPremix, 20], [lPremix, 20], [lime, 100], [boughtMash, 3000]] as const) await move(v, q, "RECEIPT");

      const dairyMeal = (await tx.product.create({ data: { organizationId: orgId, name: "Dairy meal (home-mixed)", baseUnit: "kg", variants: { create: { sku: "FEED-DMEAL", price: 0, quantityMode: "WEIGHT" } } }, include: { variants: true } })).variants[0].id;
      const layersMash = (await tx.product.create({ data: { organizationId: orgId, name: "Layers mash (home-mixed)", baseUnit: "kg", variants: { create: { sku: "FEED-HMASH", price: 0, quantityMode: "WEIGHT" } } }, include: { variants: true } })).variants[0].id;
      const ration = async (name: string, species: string, stage: string, outputVariantId: string, batchKg: number, items: [string, number][]) => {
        const r = await tx.farmRation.create({ data: { organizationId: orgId, name, species, stage, outputVariantId, batchKg } });
        await tx.farmRationItem.createMany({ data: items.map(([variantId, quantity]) => ({ organizationId: orgId, rationId: r.id, variantId, quantity })) });
        return { r, items };
      };
      const dairy = await ration("Dairy meal (home-mixed)", "Cattle", "Milking cows", dairyMeal, 70, [[germ, 42], [cake, 22], [dcp, 2], [dPremix, 1], [lime, 3]]);
      const layers = await ration("Layers mash (home-mixed)", "Chicken", "Laying hens", layersMash, 90, [[germ, 55], [cake, 15], [omena, 10], [lime, 7], [lPremix, 2.5], [dcp, 0.5]]);

      const today = todayKey();
      const ago = (n: number) => addDays(today, -n);
      const mixed = ago(12);
      const used = dairy.items.map(([variantId, q]) => ({ variantId, quantity: q * 3, unitCost: costs[variantId] }));
      const costed = batchCost(used, 207);
      const batch = await tx.farmFeedBatch.create({
        data: {
          organizationId: orgId, batchNo: batchNoFor(mixed, 1), rationId: dairy.r.id, date: asDate(mixed), kgProduced: 207, cost: costed.cost, costPerKg: costed.costPerKg,
          outputVariantId: dairyMeal, stockBranchId: branch.id, status: "APPROVED", mixedBy: manager?.id ?? null, approvedBy: owner?.id ?? null, approvedAt: new Date(`${mixed}T10:00:00Z`),
          notes: "3 batches of the recipe",
        },
      });
      await tx.farmFeedBatchItem.createMany({ data: costed.lines.map((l) => ({ organizationId: orgId, batchId: batch.id, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost ?? 0, cost: l.cost })) });
      for (const l of costed.lines) await move(l.variantId, -l.quantity, "PRODUCTION", batch.id);
      await move(dairyMeal, 207, "PRODUCTION", batch.id);
      await tx.productVariant.update({ where: { id: dairyMeal }, data: { cost: costed.costPerKg } });

      const pending = layers.items.map(([variantId, q]) => ({ variantId, quantity: q, unitCost: costs[variantId] }));
      const pCost = batchCost(pending, 88);
      const pBatch = await tx.farmFeedBatch.create({
        data: { organizationId: orgId, batchNo: batchNoFor(today, 1), rationId: layers.r.id, date: asDate(today), kgProduced: 88, cost: pCost.cost, costPerKg: pCost.costPerKg, outputVariantId: layersMash, mixedBy: manager?.id ?? null, notes: "Waiting for the manager" },
      });
      await tx.farmFeedBatchItem.createMany({ data: pCost.lines.map((l) => ({ organizationId: orgId, batchId: pBatch.id, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost ?? 0, cost: l.cost })) });

      const feed = async (target: { animalId?: string; groupId?: string }, day: string, variantId: string, kg: number) => {
        const row = await tx.farmFeeding.create({ data: { organizationId: orgId, ...target, date: asDate(day), variantId, kg, cost: Math.round(kg * (variantId === dairyMeal ? costed.costPerKg : costs[variantId]) * 100) / 100, stockBranchId: branch.id } });
        await move(variantId, -kg, "PRODUCTION", row.id);
      };
      for (let i = 11; i >= 0; i--) for (const c of cows) await feed({ animalId: c.id }, ago(i), dairyMeal, 4);
      for (let i = 13; i >= 0; i--) for (const f of flocks) await feed({ groupId: f.id }, ago(i), boughtMash, f.headCount > 500 ? 112 : 14);

      for (const [variantId, quantity] of Object.entries(stock)) {
        await tx.inventoryItem.create({ data: { branchId: branch.id, variantId, quantity: Math.round(quantity * 1000) / 1000 } });
      }
      console.log("Seeded the demo farm's feed: dairy meal mixed and fed (running low), layers mash fed to the flocks, one batch waiting for approval.");
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/** F6: four casual workers on the muster roll (last week paid in cash), a dairy co-op, a hotel and a school buying on credit, payments, and enterprise tags. */
async function seedLabourSales(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.farmWorker.count({ where: { organizationId: orgId } })) {
        console.log("The demo farm already has workers - nothing to do.");
        return;
      }
      const branch = await tx.branch.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } });
      const settings = await tx.farmProduceSettings.findFirst({ where: { organizationId: orgId } });
      const owner = await tx.orgUser.findFirst({ where: { organizationId: orgId, role: "OWNER" } });
      const manager = await tx.orgUser.findFirst({ where: { organizationId: orgId, role: "MANAGER" } });
      const ent = async (name: string) => (await tx.farmEnterprise.findFirst({ where: { organizationId: orgId, name } }))?.id ?? null;
      const unit = async (name: string) => (await tx.farmUnit.findFirst({ where: { organizationId: orgId, name } }))?.id ?? null;
      if (!branch || !settings?.milkVariantId || !settings.eggVariantId) return;
      const [dairy, layers, beansEnt] = [await ent("Dairy herd"), await ent("Layers (Isa Brown)"), await ent("Beans")];
      const today = todayKey();
      const ago = (k: number) => addDays(today, -k);

      const worker = (name: string, phone: string, idNumber: string, dailyRate: number, notes: string) => tx.farmWorker.create({ data: { organizationId: orgId, name, phone, idNumber, dailyRate, notes } });
      const ws = [
        await worker("Otieno Ouma", "254711000101", "28111201", 700, "Milking and cow shed"),
        await worker("Akinyi Atieno", "254711000102", "30222302", 650, "Poultry house"),
        await worker("Ochieng Odhiambo", "254711000103", "27333403", 600, "Fields"),
        await worker("Wanjiru Kamau", "254711000104", "31444504", 600, "Fields and feed mixing"),
      ];
      const places = [await unit("Zero-grazing cow shed"), await unit("Layers house 1"), await unit("Maize field"), await unit("Feed mixing room")];
      const tasks = ["Milking and feeding", "Collecting eggs and cleaning", "Weeding", "Mixing feed"];
      const enterprises = [dairy, layers, await ent("Maize long rains"), await ent("Feed mixing")];
      for (let k = 13; k >= 0; k--) {
        const day = ago(k);
        if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue;
        for (const [i, w] of ws.entries()) {
          const status = i === 3 && k % 4 === 0 ? "HALF_DAY" : i === 2 && k === 5 ? "ABSENT" : "PRESENT";
          await tx.farmMuster.create({ data: { organizationId: orgId, workerId: w.id, date: asDate(day), status, task: tasks[i], unitId: places[i], enterpriseId: enterprises[i], recordedBy: manager?.id ?? null } });
        }
      }

      const start = ago(13);
      const end = ago(7);
      const marks = await tx.farmMuster.findMany({ where: { organizationId: orgId, date: { gte: asDate(start), lte: asDate(end) }, status: { not: "ABSENT" } } });
      const run = await tx.farmWageRun.create({
        data: { organizationId: orgId, number: "WAGE-001", periodStart: asDate(start), periodEnd: asDate(end), status: "PAID", createdBy: manager?.id ?? null, approvedBy: owner?.id ?? null, approvedAt: new Date(), paidAt: new Date() },
      });
      let gross = 0;
      let net = 0;
      for (const w of ws) {
        const days = marks.filter((m) => m.workerId === w.id).reduce((s, m) => s + (m.status === "HALF_DAY" ? 0.5 : 1), 0);
        const g = days * Number(w.dailyRate);
        const shif = Math.round(Math.max(g * 0.0275, (300 * 7) / 30) * 100) / 100;
        const housing = Math.round(g * 0.015 * 100) / 100;
        const nssf = Math.round(g * 0.06 * 100) / 100;
        const ded = Math.round((shif + housing + nssf) * 100) / 100;
        gross += g;
        net += g - ded;
        await tx.farmWageLine.create({
          data: { organizationId: orgId, runId: run.id, workerId: w.id, days, dailyRate: w.dailyRate, gross: g, nssf, shif, housingLevy: housing, paye: 0, deductions: ded, net: g - ded, status: "PAID", method: "CASH", paidAt: new Date(), paidBy: manager?.id ?? null },
        });
      }
      await tx.farmWageRun.update({ where: { id: run.id }, data: { workers: ws.length, gross, deductions: Math.round((gross - net) * 100) / 100, net: Math.round(net * 100) / 100 } });

      const buyer = (name: string, kind: "COOP" | "HOTEL" | "SCHOOL", extra: Record<string, unknown>) => tx.farmBuyer.create({ data: { organizationId: orgId, name, kind, ...extra } });
      const coop = await buyer("Uriri Dairy Farmers Co-operative", "COOP", { memberNo: "UDF-0417", phone: "0700100200", creditLimit: 60000, termsDays: 30, notes: "Collects at the gate every morning" });
      const hotel = await buyer("Rongo Highway Hotel", "HOTEL", { phone: "0700300400", creditLimit: 15000, termsDays: 14 });
      const school = await buyer("St. Mary's Girls, Uriri", "SCHOOL", { phone: "0700500600", creditLimit: 30000, termsDays: 30, kraPin: "P051234567X" });

      const moved: Record<string, number> = {};
      const deliver = async (b: { id: string }, day: string, variantId: string, quantity: number, unitPrice: number, enterpriseId: string | null, slipNo: string | null, session: "AM" | null = null) => {
        const d = await tx.farmDelivery.create({ data: { organizationId: orgId, buyerId: b.id, date: asDate(day), session, variantId, quantity, unitPrice, amount: quantity * unitPrice, enterpriseId, slipNo, stockBranchId: branch.id, createdBy: manager?.id ?? null } });
        await tx.inventoryTransaction.create({ data: { branchId: branch.id, variantId, type: "CREDIT_SALE", quantityDelta: -quantity, referenceId: d.id } });
        moved[variantId] = (moved[variantId] ?? 0) + quantity;
      };
      for (let k = 13; k >= 1; k--) await deliver(coop, ago(k), settings.milkVariantId, 20, 52, dairy, `UDF-${String(5000 + 14 - k)}`, "AM");
      for (let k = 12; k >= 0; k -= 3) await deliver(hotel, ago(k), settings.eggVariantId, 3, 420, layers, null);
      await deliver(school, ago(10), settings.eggVariantId, 10, 400, layers, "LPO 2291");
      for (const [v, q] of Object.entries(moved)) {
        await tx.inventoryItem.update({ where: { branchId_variantId: { branchId: branch.id, variantId: v } }, data: { quantity: { decrement: q } } });
      }
      await tx.farmBuyerPayment.create({ data: { organizationId: orgId, buyerId: coop.id, date: asDate(ago(5)), amount: 7280, method: "BANK", reference: "EQ-UDF-NOV-1", notes: "Co-op payout, first week" } });
      await tx.farmBuyerPayment.create({ data: { organizationId: orgId, buyerId: hotel.id, date: asDate(ago(4)), amount: 2520, method: "MPESA", reference: "SKL4R2T7QW" } });

      const tag = async (variantId: string | null | undefined, enterpriseId: string | null) =>
        variantId && enterpriseId ? tx.farmProductTag.create({ data: { organizationId: orgId, variantId, enterpriseId } }) : null;
      await tag(settings.milkVariantId, dairy);
      await tag(settings.eggVariantId, layers);
      await tag((await tx.productVariant.findFirst({ where: { sku: "FARM-BEANS", product: { organizationId: orgId } } }))?.id, beansEnt);
      console.log("Seeded the demo farm's workers (last week paid), the co-op, hotel and school on credit, and enterprise tags.");
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/** Valuation rates set to Migori market prices, and a 25% margin. */
async function seedValuation(orgId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
    if (await tx.farmValuationRate.count({ where: { organizationId: orgId } })) return;
    await tx.farmSettings.update({ where: { organizationId: orgId }, data: { valuationMarginRate: 0.25, valuationProductionDays: 90 } });
    await tx.farmValuationRate.createMany({
      data: [
        { organizationId: orgId, species: "CATTLE", birthValueKes: 6000, pricePerKgKes: 280, primeAgeMonths: 96, ageDropRate: 0.15 },
        { organizationId: orgId, species: "CHICKEN", birthValueKes: 120, pricePerKgKes: 450, primeAgeMonths: 18, ageDropRate: 0.2 },
        { organizationId: orgId, species: "GOAT", birthValueKes: 1800, pricePerKgKes: 420, primeAgeMonths: 72, ageDropRate: 0.15 },
      ],
    });
    console.log("Seeded the demo farm's valuation rates (cattle, chickens, goats) and a 25% margin.");
  });
}

/** The demo farm's bought items (fertiliser, spray, feed ingredients, bought mash, vet drugs) are farm inputs, apart from its own produce. */
async function seedInputs(orgId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;

    const kinds: Record<string, "FERTILISER" | "CHEMICAL" | "FEED"> = {
      "FARM-DAP": "FERTILISER", "FARM-CAN": "FERTILISER", "FARM-DUDU": "CHEMICAL",
      "FEED-GERM": "FEED", "FEED-CAKE": "FEED", "FEED-OMENA": "FEED", "FEED-DCP": "FEED", "FEED-DPREMIX": "FEED", "FEED-LPREMIX": "FEED", "FEED-LIME": "FEED", "FEED-LMASH": "FEED",
    };
    const variants = await tx.productVariant.findMany({ where: { sku: { in: Object.keys(kinds) }, product: { organizationId: orgId } }, select: { sku: true, productId: true } });
    const drugs = await tx.farmDrug.findMany({ where: { organizationId: orgId, variantId: { not: null } }, select: { variantId: true } });
    const drugProducts = await tx.productVariant.findMany({ where: { id: { in: drugs.map((d) => d.variantId as string) } }, select: { productId: true } });
    const rows = [...variants.map((v) => ({ organizationId: orgId, productId: v.productId, kind: kinds[v.sku] })), ...drugProducts.map((d) => ({ organizationId: orgId, productId: d.productId, kind: "VET_DRUG" as const }))];

    const added = await tx.farmInput.createMany({ data: rows, skipDuplicates: true });
    if (added.count) console.log(`Seeded the demo farm's inputs: ${added.count} bought items kept apart from its own produce.`);
  });
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
