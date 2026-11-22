import { FarmEnterpriseKind, FarmRoleCode, FarmUnitKind, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { FarmSetupService } from "../src/farm/farm-setup.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addDays, asDate, todayKey } from "../src/farm/farm-livestock.util";

/**
 * Zaroda Shamba demo farm (docs/farm): "Uriri Dairy & Poultry Farm" with its staff, layout and enterprises.
 * Safe to re-run: an existing demo farm is left as it is. Run: pnpm --filter api seed:farm
 * Sign in at /shamba/login as owner@shamba.demo (password123).
 */
const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: "Uriri Dairy & Poultry Farm", industryType: "FARM" } });
  if (existing) {
    await seedLivestock(existing.id);
    return;
  }
  const orgId = randomUUID();
  const hash = await bcrypt.hash("password123", 10);
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
  console.log("Seeded the demo farm. Sign in at /shamba/login as owner@shamba.demo / password123.");
}

/** F2: herd, flocks, drugs, programmes, a treatment still in withdrawal and a cow in calf. Skipped once the farm has animals. */
async function seedLivestock(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.farmAnimal.count()) {
        console.log("The demo farm already has its animals - nothing to do.");
        return;
      }
      const today = todayKey();
      const ago = (n: number) => addDays(today, -n);
      const unitId = async (name: string) => (await tx.farmUnit.findFirst({ where: { name } }))?.id ?? null;
      const entId = async (name: string) => (await tx.farmEnterprise.findFirst({ where: { name } }))?.id ?? null;
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
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  console.log("Seeded the demo farm's animals, flocks, drugs and programmes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
