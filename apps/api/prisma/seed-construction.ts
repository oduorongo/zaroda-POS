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
  await seedSite(orgId);
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

const WORKERS: [string, string, number, boolean, number | null][] = [
  ["Joseph Okoth", "Foreman", 1800, true, 400],
  ["Peter Onyango", "Mason", 1500, false, 220],
  ["Samuel Odera", "Mason", 1500, false, -15],
  ["Kevin Achola", "Mason", 1400, false, 25],
  ["Moses Otieno", "Carpenter", 1400, false, 300],
  ["Philip Owino", "Carpenter", 1400, false, null],
  ["Tom Mboya Ojwang", "Steel fixer", 1400, false, null],
  ["Daniel Omolo", "Plumber", 1500, false, 500],
  ["George Ouko", "Electrician", 1600, false, 450],
  ["Mary Akinyi", "Helper", 800, false, null],
  ["Jane Atieno", "Helper", 800, false, null],
  ["Beatrice Adhiambo", "Helper", 800, false, null],
  ["John Ochieng", "Helper", 800, false, null],
  ["Paul Odhiambo", "Helper", 800, false, null],
  ["Esther Anyango", "Store helper", 900, false, null],
];
const WEATHER = ["Sunny", "Sunny, hot", "Cloudy", "Light rain in the afternoon", "Sunny", "Heavy rain from 2pm", "Sunny"];
const WORKS = [
  "Walling to classroom 2 up to lintel level; ring beam formwork started.",
  "Ring beam reinforcement fixed to classrooms 1 and 2.",
  "Concrete to ring beam classroom 1 (3.5 m3). Walling continued on classroom 3.",
  "Walling classroom 3; curing ring beam.",
  "Ring beam concrete classroom 2. Gable walls started.",
  "Gable walls continued; works stopped at 2pm because of rain.",
  "Gable walls completed classroom 1; roof trusses delivered.",
];

/** C3: 15 workers on PRJ-001 and the last 7 days of diaries, muster roll and safety records. */
async function seedSite(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      const project = await tx.conProject.findFirst({ where: { name: "Uriri Day Secondary Classrooms" } });
      if (!project) return;
      if (await tx.conWorker.count({ where: { projectId: project.id } })) {
        console.log("Site workers already seeded - nothing to do.");
        return;
      }
      const pid = project.id;
      const site = await tx.orgUser.findFirst({ where: { user: { email: "site@uriri.demo" } } });
      const workers = [];
      for (const [i, [name, trade, dailyRate, isSupervisor, cardDays]] of WORKERS.entries()) {
        workers.push(
          await tx.conWorker.create({
            data: {
              organizationId: orgId, projectId: pid, name, trade, dailyRate, isSupervisor,
              idNo: String(23456700 + i * 137), phone: `07${String(10000000 + i * 4111).slice(0, 8)}`,
              ncaCardNo: cardDays === null ? null : `NCA/SW/2025/${4100 + i}`, ncaExpiresAt: cardDays === null ? null : inDays(cardDays),
            },
          }),
        );
      }
      for (let back = 6; back >= 0; back--) {
        const date = inDays(-back);
        const marks = workers.map((w, i) => ({
          organizationId: orgId, projectId: pid, workerId: w.id, date, markedBy: site?.id,
          status: (i + back) % 9 === 0 ? ("ABSENT" as const) : back === 1 && i > 9 ? ("HALF" as const) : ("PRESENT" as const),
        }));
        await tx.conMuster.createMany({ data: marks.map((m) => ({ ...m, hours: m.status === "PRESENT" ? 8 : m.status === "HALF" ? 4 : 0 })) });
        const present = marks.filter((m) => m.status !== "ABSENT").length;
        await tx.conSiteDiary.create({
          data: {
            organizationId: orgId, projectId: pid, date, weather: WEATHER[6 - back], worksDone: WORKS[6 - back], labourCount: present,
            delays: back === 1 ? "Rain stopped work from 2pm." : null, visitors: back === 3 ? "Client's QS (site measurement)" : null, plantOnSite: "Concrete mixer, poker vibrator",
            status: back >= 2 ? "APPROVED" : back === 1 ? "SUBMITTED" : "DRAFT", createdBy: site?.id, approvedAt: back >= 2 ? inDays(-back + 1) : null,
          },
        });
      }
      const architect = await tx.conParty.findFirst({ where: { kind: "ARCHITECT" } });
      await tx.conSiteInstruction.createMany({
        data: [
          { organizationId: orgId, projectId: pid, number: "SI-001", partyId: architect?.id, date: inDays(-12), description: "Raise ring beam by one course to suit revised window heights.", status: "ACTIONED" },
          { organizationId: orgId, projectId: pid, number: "SI-002", partyId: architect?.id, date: inDays(-2), description: "Provide an additional rainwater downpipe on the north elevation.", status: "OPEN" },
        ],
      });
      await tx.conToolboxTalk.createMany({
        data: [
          { organizationId: orgId, projectId: pid, date: inDays(-6), topic: "Working on scaffolds and ladders", attendeeIds: workers.slice(0, 12).map((w) => w.id), heldBy: site?.id },
          { organizationId: orgId, projectId: pid, date: inDays(-1), topic: "Manual handling of roof trusses", attendeeIds: workers.map((w) => w.id), heldBy: site?.id },
        ],
      });
      await tx.conPpeIssue.createMany({ data: workers.slice(0, 10).map((w) => ({ organizationId: orgId, projectId: pid, workerId: w.id, item: "Safety helmet", qty: 1, issuedAt: inDays(-30), issuedBy: site?.id })) });
      await tx.conPpeIssue.createMany({ data: workers.slice(0, 10).map((w) => ({ organizationId: orgId, projectId: pid, workerId: w.id, item: "Safety boots", qty: 1, issuedAt: inDays(-30), issuedBy: site?.id })) });
      const now = new Date();
      await tx.conPermitToWork.create({
        data: { organizationId: orgId, projectId: pid, number: "PTW-001", type: "HEIGHT", location: "Classroom 1 gable wall", precautions: "Scaffold inspected; harness for work above 2m", validFrom: now, validTo: new Date(now.getTime() + 3 * DAY), issuedBy: site?.id },
      });
      await tx.conIncident.createMany({
        data: [
          { organizationId: orgId, projectId: pid, occurredAt: inDays(-5), severity: "MINOR", description: "Cut to left hand while cutting hoop iron; first aid given.", actionTaken: "Gloves issued for cutting work", workerId: workers[11].id, createdBy: site?.id },
          { organizationId: orgId, projectId: pid, occurredAt: inDays(-2), severity: "LOST_TIME", description: "Helper slipped from the second scaffold lift; sprained ankle, off work 4 days.", actionTaken: "Scaffold boards replaced; toolbox talk held", workerId: workers[12].id, reportDueAt: new Date(inDays(-2).getTime() + 7 * DAY), createdBy: site?.id },
        ],
      });
      console.log("Seeded 15 workers, 7 days of diaries and muster, toolbox talks, PPE, a permit-to-work and 2 incidents.");
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
