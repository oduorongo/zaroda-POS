import { FarmEnterpriseKind, FarmRoleCode, FarmUnitKind, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { FarmSetupService } from "../src/farm/farm-setup.service";
import { PrismaService } from "../src/common/prisma/prisma.service";

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
    console.log("The demo farm already exists - nothing to do.");
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
  console.log("Seeded the demo farm. Sign in at /shamba/login as owner@shamba.demo / password123.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
