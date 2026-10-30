import { ConDocType, ConRoleCode, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { ConSetupService } from "../src/construction/common/con-setup.service";
import { PrismaService } from "../src/common/prisma/prisma.service";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + n * DAY);

/**
 * Demo construction tenant "Uriri Builders Ltd" (NCA5 Building, NCA6 Roads) on the Contractor plan, with staff in construction
 * roles and a compliance vault showing green, amber and red documents. Dev/demo only. Run after the construction migration:
 *   npx ts-node prisma/seed-construction.ts
 * Sign in with director@uriri.demo / password123 (also compliance@, qs@, accounts@).
 */
async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: "Uriri Builders Ltd", industryType: "CONSTRUCTION" } });
  if (existing) {
    console.log(`Uriri Builders Ltd already exists (${existing.id}) - nothing to do.`);
    return;
  }

  const orgId = randomUUID();
  const hash = await bcrypt.hash("password123", 10);
  const staff: { email: string; fullName: string; role: Role; con: ConRoleCode[] }[] = [
    { email: "director@uriri.demo", fullName: "Achieng Odhiambo", role: Role.OWNER, con: ["CON_DIRECTOR"] },
    { email: "compliance@uriri.demo", fullName: "Brian Otieno", role: Role.MANAGER, con: ["CON_COMPLIANCE"] },
    { email: "qs@uriri.demo", fullName: "Caroline Wanjiku", role: Role.MANAGER, con: ["CON_QS"] },
    { email: "accounts@uriri.demo", fullName: "David Kiprono", role: Role.MANAGER, con: ["CON_ACCOUNTANT"] },
  ];

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      await tx.organization.create({
        data: { id: orgId, name: "Uriri Builders Ltd", industryType: "CONSTRUCTION", country: "KE", baseCurrency: "KES", phone: "0700000000", email: "info@uriri.demo" },
      });
      await tx.branch.create({ data: { organizationId: orgId, name: "Head Office", county: "Migori", subCounty: "Uriri" } });

      for (const s of staff) {
        const user = await tx.user.create({ data: { email: s.email, fullName: s.fullName, passwordHash: hash } });
        const orgUser = await tx.orgUser.create({ data: { organizationId: orgId, userId: user.id, role: s.role } });
        await tx.conUserRole.createMany({ data: s.con.map((role) => ({ organizationId: orgId, orgUserId: orgUser.id, role })) });
      }

      await new ConSetupService(prisma as unknown as PrismaService).ensure(tx, orgId);
      const sub = await tx.conSubscription.update({
        where: { organizationId: orgId },
        data: { planCode: "CON_CONTRACTOR", cycle: "MONTHLY", status: "ACTIVE", currentPeriodEnd: inDays(30), paidPaymentsCount: 1 },
      });
      await tx.conSubscriptionPayment.create({
        data: { organizationId: orgId, planCode: "CON_CONTRACTOR", cycle: "MONTHLY", months: 1, amount: 9500, status: "PAID", method: "BANK", receipt: "DEMO-0001", paidAt: new Date(), periodEndAfter: sub.currentPeriodEnd },
      });

      await tx.conCompanyRegistration.createMany({
        data: [
          { organizationId: orgId, worksClass: "BUILDING", ncaCategory: 5, regNo: "NCA/B5/2019/0412", registeredAt: inDays(-2400), licenceExpiresAt: inDays(200) },
          { organizationId: orgId, worksClass: "ROADS_CIVIL", ncaCategory: 6, regNo: "NCA/R6/2021/0877", registeredAt: inDays(-1500), licenceExpiresAt: inDays(25) },
        ],
      });

      const docs: { type: ConDocType; title: string; refNo: string; issued: number; expires: number | null }[] = [
        { type: "NCA_CERT", title: "NCA registration certificate", refNo: "NCA/B5/2019/0412", issued: -2400, expires: null },
        { type: "NCA_LICENCE", title: "NCA practising licence 2026", refNo: "PL-2026-0412", issued: -165, expires: 200 },
        { type: "KRA_TCC", title: "KRA tax compliance certificate", refNo: "KRA20260011223", issued: -345, expires: 20 },
        { type: "BUSINESS_PERMIT", title: "Migori County single business permit", refNo: "MGR/SBP/2025/3321", issued: -375, expires: -10 },
        { type: "WIBA", title: "WIBA policy - Jubilee", refNo: "WIBA/2026/7781", issued: -65, expires: 300 },
        { type: "INSURANCE_CAR", title: "Contractor's all risks", refNo: "CAR/2026/1204", issued: -275, expires: 90 },
      ];
      await tx.conComplianceDoc.createMany({
        data: docs.map((d) => ({ organizationId: orgId, type: d.type, title: d.title, refNo: d.refNo, issuedAt: inDays(d.issued), expiresAt: d.expires === null ? null : inDays(d.expires) })),
      });
    },
    { timeout: 60_000, maxWait: 30_000 },
  );

  console.log(`Seeded Uriri Builders Ltd (${orgId}). Sign in with director@uriri.demo / password123.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
