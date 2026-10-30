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
 * Sign in with director@uriri.demo / password123 (also compliance@, qs@, accounts@, pm@, site@).
 */
async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: "Uriri Builders Ltd", industryType: "CONSTRUCTION" } });
  const orgId = existing?.id ?? (await seedCompany());
  await seedProject(orgId);
}

const hashed = bcrypt.hash("password123", 10);

/** C1: the business, staff, plan, NCA registrations and compliance vault. */
async function seedCompany(): Promise<string> {
  const orgId = randomUUID();
  const hash = await hashed;
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
  return orgId;
}

const BQ: [string, [string, string, number, number][]][] = [
  ["PRELIMINARIES", [
    ["Site establishment, hoarding and site office", "Item", 1, 350000],
    ["Contractor's all risks insurance", "Item", 1, 120000],
    ["Water and electricity for the works", "Item", 1, 80000],
    ["Setting out the works", "Item", 1, 45000],
  ]],
  ["SUBSTRUCTURE", [
    ["Excavate oversite to remove topsoil average 150mm deep", "m²", 420, 85],
    ["Excavate foundation trenches not exceeding 1.5m deep", "m³", 180, 650],
    ["Hardcore filling 200mm thick, well compacted", "m²", 400, 450],
    ["Anti-termite treatment to hardcore", "m²", 400, 120],
    ["Concrete class 15 blinding 50mm thick", "m²", 400, 380],
    ["Concrete class 20 in strip footings", "m³", 36, 14500],
    ["200mm natural stone foundation walling", "m²", 210, 2100],
    ["150mm ground floor slab, class 20 concrete with A142 mesh", "m²", 400, 2650],
  ]],
  ["SUPERSTRUCTURE", [
    ["Concrete class 25 in columns and ring beams", "m³", 28, 16800],
    ["High-yield steel reinforcement bars", "kg", 4200, 165],
    ["Sawn formwork to columns and beams", "m²", 260, 950],
    ["200mm machine-cut stone walling", "m²", 620, 2250],
    ["Hoop iron in walling, 2 courses", "m", 900, 45],
  ]],
  ["ROOFING", [
    ["Treated cypress timber roof trusses", "no.", 14, 28500],
    ["50x50mm treated purlins", "m", 840, 210],
    ["Gauge 28 pre-painted iron roofing sheets", "m²", 520, 1150],
    ["Fascia board and PVC gutters", "m", 120, 1400],
  ]],
  ["DOORS AND WINDOWS", [
    ["Steel casement windows, glazed", "m²", 96, 6800],
    ["Steel doors complete with frame and lock", "no.", 6, 38000],
  ]],
  ["FINISHES", [
    ["Cement-sand screed 40mm to floors", "m²", 400, 650],
    ["Internal plaster 12mm to walls", "m²", 1240, 480],
    ["External rendering to walls", "m²", 640, 560],
    ["Three coats emulsion paint", "m²", 1880, 320],
    ["Chalkboards 2400x1200mm", "no.", 4, 18500],
  ]],
  ["ELECTRICAL AND DRAINAGE", [
    ["Electrical installation: lighting and sockets", "Item", 1, 420000],
    ["10,000 litre rainwater tank with stand", "no.", 1, 185000],
  ]],
];

/** C2: an active project "Uriri Day Secondary Classrooms" with a 30-line BQ, permits, team, programme and two tenders. */
async function seedProject(orgId: string) {
  const name = "Uriri Day Secondary Classrooms";
  const hash = await hashed;
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.conProject.findFirst({ where: { name } })) {
        console.log(`${name} already exists - nothing to do.`);
        return;
      }
      const site: { email: string; fullName: string; role: Role; project: ConRoleCode }[] = [
        { email: "pm@uriri.demo", fullName: "Evans Omondi", role: Role.MANAGER, project: "CON_PROJECT_MGR" },
        { email: "site@uriri.demo", fullName: "Fredrick Ouma", role: Role.SUPERVISOR, project: "CON_SITE_SUPERVISOR" },
      ];
      const members: { orgUserId: string; role: ConRoleCode }[] = [];
      for (const s of site) {
        const user = (await tx.user.findUnique({ where: { email: s.email } })) ?? (await tx.user.create({ data: { email: s.email, fullName: s.fullName, passwordHash: hash } }));
        const orgUser = (await tx.orgUser.findFirst({ where: { userId: user.id } })) ?? (await tx.orgUser.create({ data: { organizationId: orgId, userId: user.id, role: s.role } }));
        members.push({ orgUserId: orgUser.id, role: s.project });
      }
      await tx.conStaffAccreditation.create({ data: { organizationId: orgId, orgUserId: members[1].orgUserId, cardNo: "NCA/SS/2024/1187", expiresAt: inDays(540) } });

      const party = (kind: "CLIENT" | "ARCHITECT" | "QS" | "ENGINEER", partyName: string, contactPerson: string, phone: string) =>
        tx.conParty.create({ data: { organizationId: orgId, kind, name: partyName, contactPerson, phone } });
      const client = await party("CLIENT", "Board of Management, Uriri Day Secondary School", "The Principal", "0711000001");
      const architect = await party("ARCHITECT", "Ochieng & Associates Architects", "Arch. P. Ochieng", "0711000002");
      const qs = await party("QS", "Lakeview Quantity Surveyors", "QS M. Akinyi", "0711000003");
      const engineer = await party("ENGINEER", "Nyanza Structural Consultants", "Eng. T. Were", "0711000004");

      const total = BQ.flatMap(([, items]) => items).reduce((a, [, , qty, rate]) => a + qty * rate, 0);
      const tender = await tx.conTender.create({
        data: { organizationId: orgId, ref: "UDSS/BOM/01/2026", title: name, procuringEntity: client.name, isPublic: true, worksClass: "BUILDING", estValue: total, closingAt: inDays(-90), status: "WON", outcomeNote: "Awarded by the Board of Management" },
      });
      await tx.conTender.createMany({
        data: [
          { organizationId: orgId, ref: "MCG/HLTH/T/014", title: "Rongo Sub-County Hospital maternity ward", procuringEntity: "County Government of Migori", worksClass: "BUILDING", estValue: 64500000, closingAt: inDays(21), bidBond: 1290000, bidBondExpiresAt: inDays(140) },
          { organizationId: orgId, ref: "KeRRA/MGR/2026/07", title: "Rehabilitation of Uriri-Oyani road (6km)", procuringEntity: "Kenya Rural Roads Authority", worksClass: "ROADS_CIVIL", estValue: 85000000, closingAt: inDays(35), agpoReserved: false },
        ],
      });

      const project = await tx.conProject.create({
        data: {
          organizationId: orgId, code: "PRJ-001", name, clientId: client.id, tenderId: tender.id, worksClass: "BUILDING", contractSum: total, formOfContract: "PPADA",
          startDate: inDays(-60), completionDate: inDays(120), dlpMonths: 6, county: "Migori", location: "Uriri, off Migori-Kisii road", lat: -0.9467, lng: 34.4719, status: "ACTIVE",
        },
      });
      const pid = project.id;
      await tx.conProjectParty.createMany({ data: [architect, qs, engineer].map((p) => ({ organizationId: orgId, projectId: pid, partyId: p.id, role: p.kind })) });
      await tx.conProjectMember.createMany({ data: members.map((m) => ({ organizationId: orgId, projectId: pid, ...m })) });
      await tx.conProjectPermit.createMany({
        data: [
          { organizationId: orgId, projectId: pid, type: "NCA_PROJECT_REG", status: "APPROVED", refNo: "NCA/PR/2026/55120", issuedAt: inDays(-70) },
          { organizationId: orgId, projectId: pid, type: "COUNTY_APPROVAL", status: "APPROVED", refNo: "MGR/PLN/2026/118", issuedAt: inDays(-80) },
          { organizationId: orgId, projectId: pid, type: "BUILDING_PERMIT", status: "APPROVED", refNo: "MGR/BP/2026/093", issuedAt: inDays(-75) },
          { organizationId: orgId, projectId: pid, type: "NEMA_EIA", status: "NOT_REQUIRED", notes: "Small public works - EIA not required" },
          { organizationId: orgId, projectId: pid, type: "DOSHS_REG", status: "APPROVED", refNo: "DOSHS/WP/MGR/0442", issuedAt: inDays(-58), expiresAt: inDays(305) },
          { organizationId: orgId, projectId: pid, type: "OCCUPANCY", status: "PENDING" },
        ],
      });
      const ms: [string, number, number, number][] = [
        ["Mobilisation", -60, -50, 100],
        ["Substructure", -49, -20, 100],
        ["Superstructure walling and beams", -19, 25, 60],
        ["Roofing", 26, 50, 0],
        ["Doors, windows and finishes", 51, 105, 0],
        ["Electrical, tank and handover", 106, 120, 0],
      ];
      await tx.conMilestone.createMany({ data: ms.map(([n, s, e, pc], i) => ({ organizationId: orgId, projectId: pid, name: n, startDate: inDays(s), endDate: inDays(e), percentComplete: pc, sortOrder: i })) });
      for (const [si, [sectionName, items]] of BQ.entries()) {
        const section = await tx.conBqSection.create({ data: { organizationId: orgId, projectId: pid, code: `BILL ${si + 1}`, name: sectionName, sortOrder: si } });
        await tx.conBqItem.createMany({
          data: items.map(([description, unit, qty, rate], ii) => ({ organizationId: orgId, projectId: pid, sectionId: section.id, code: String.fromCharCode(65 + ii), description, unit, qty, rate, amount: qty * rate, sortOrder: ii })),
        });
      }
      console.log(`Seeded ${name}: 30 BQ items, KES ${total.toLocaleString("en-KE")}.`);
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
