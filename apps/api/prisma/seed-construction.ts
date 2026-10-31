import { ConDocType, ConRoleCode, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { ConSetupService } from "../src/construction/common/con-setup.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { recordIpcSale } from "../src/construction/commercial/ipc-sale";
import { previousCertified, valuation } from "../src/construction/commercial/valuation.util";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + n * DAY);

/**
 * Demo construction tenant "Uriri Builders Ltd" (NCA5 Building, NCA6 Roads) on the Contractor plan, with staff in construction
 * roles and a compliance vault showing green, amber and red documents. Dev/demo only. Run after the construction migration:
 *   npx ts-node prisma/seed-construction.ts
 * Sign in with director@uriri.demo / password123 (also compliance@, qs@, accounts@, pm@, site@, procurement@, store@).
 */
async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: "Uriri Builders Ltd", industryType: "CONSTRUCTION" } });
  const orgId = existing?.id ?? (await seedCompany());
  await seedProject(orgId);
  await seedSite(orgId);
  await seedMaterials(orgId);
  await seedCommercial(orgId);
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

const MATERIALS: [string, string, "COUNT" | "WEIGHT", number, number][] = [
  ["Cement OPC 42.5 (50kg)", "bag", "COUNT", 780, 1300],
  ["Y12 high-yield steel bar (12m)", "length", "COUNT", 1150, 380],
  ["Y8 steel bar (12m)", "length", "COUNT", 520, 220],
  ["Ballast 3/4\"", "tonne", "WEIGHT", 2600, 120],
  ["River sand", "tonne", "WEIGHT", 2200, 150],
  ["Machine-cut stone 9x9", "piece", "COUNT", 75, 6000],
];

/** C4: materials on the shared catalogue, the project's site store, a requisition → LPO → two deliveries → issues flow, a second LPO awaiting approval, and plant. */
async function seedMaterials(orgId: string) {
  const hash = await hashed;
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      const project = await tx.conProject.findFirst({ where: { name: "Uriri Day Secondary Classrooms" } });
      if (!project) return;
      if (await tx.conLpo.count({ where: { projectId: project.id } })) {
        console.log("Materials already seeded - nothing to do.");
        return;
      }
      const pid = project.id;
      const person = async (email: string, fullName: string, role: Role) => {
        const user = (await tx.user.findUnique({ where: { email } })) ?? (await tx.user.create({ data: { email, fullName, passwordHash: hash } }));
        return (await tx.orgUser.findFirst({ where: { userId: user.id } })) ?? tx.orgUser.create({ data: { organizationId: orgId, userId: user.id, role } });
      };
      const proc = await person("procurement@uriri.demo", "Grace Moraa", Role.MANAGER);
      await tx.conUserRole.createMany({ data: [{ organizationId: orgId, orgUserId: proc.id, role: "CON_PROCUREMENT" }], skipDuplicates: true });
      const store = await person("store@uriri.demo", "Henry Ndege", Role.SUPERVISOR);
      await tx.conProjectMember.createMany({ data: [{ organizationId: orgId, projectId: pid, orgUserId: store.id, role: "CON_STOREKEEPER" }], skipDuplicates: true });
      const pm = await tx.orgUser.findFirst({ where: { user: { email: "pm@uriri.demo" } } });
      const site = await tx.orgUser.findFirst({ where: { user: { email: "site@uriri.demo" } } });
      const director = await tx.orgUser.findFirst({ where: { user: { email: "director@uriri.demo" } } });

      const branch = await tx.branch.create({ data: { organizationId: orgId, name: `${project.code} site - ${project.name}`, county: project.county } });
      await tx.conProject.update({ where: { id: pid }, data: { branchId: branch.id } });

      const variants: Record<string, { id: string }> = {};
      for (const [name, unit, mode, cost, budget] of MATERIALS) {
        const product = (await tx.product.findFirst({ where: { name } })) ?? (await tx.product.create({ data: { organizationId: orgId, name, baseUnit: unit } }));
        const variant = (await tx.productVariant.findFirst({ where: { productId: product.id } })) ?? (await tx.productVariant.create({ data: { productId: product.id, sku: `MAT-${name.replace(/[^A-Z0-9]/gi, "").slice(0, 10).toUpperCase()}`, price: 0, cost, quantityMode: mode } }));
        variants[name] = variant;
        await tx.conMaterialBudget.create({ data: { organizationId: orgId, projectId: pid, variantId: variant.id, qty: budget } });
      }
      const v = (i: number) => variants[MATERIALS[i][0]].id;
      const supplier = await tx.supplier.create({ data: { organizationId: orgId, name: "Migori Hardware & Building Supplies", phone: "0722000111", paymentTermsDays: 30 } });
      const plantHire = await tx.supplier.create({ data: { organizationId: orgId, name: "Lake Basin Plant Hire", phone: "0733000222", paymentTermsDays: 14 } });

      const bq = await tx.conBqItem.findMany({ where: { projectId: pid }, orderBy: { sortOrder: "asc" } });
      const concrete = bq.find((b) => b.description.startsWith("Concrete class 25")) ?? bq[0];
      const slab = bq.find((b) => b.description.startsWith("150mm ground floor slab")) ?? bq[0];

      const req = await tx.conRequisition.create({
        data: {
          organizationId: orgId, projectId: pid, number: "REQ-001", status: "ORDERED", neededBy: inDays(-8), createdBy: site!.id, approvedBy: pm!.id, approvedAt: inDays(-11),
          notes: "For ring beams and gable walls",
          lines: { create: [[0, 400], [1, 150], [3, 40]].map(([i, qty]) => ({ organizationId: orgId, variantId: v(i), qty, bqItemId: concrete.id })) },
        },
      });
      const lines1: [number, number][] = [[0, 400], [1, 150], [3, 40]];
      const po1 = await tx.purchaseOrder.create({
        data: { organizationId: orgId, branchId: branch.id, supplierId: supplier.id, status: "PARTIALLY_RECEIVED", createdById: proc.id, notes: "Deliver to Uriri Day Secondary site",
          lineItems: { create: lines1.map(([i, qty]) => ({ variantId: v(i), quantityOrdered: qty, unitCost: MATERIALS[i][3] })) } },
        include: { lineItems: true },
      });
      const total1 = lines1.reduce((a, [i, q]) => a + q * MATERIALS[i][3], 0);
      await tx.conLpo.create({ data: { organizationId: orgId, projectId: pid, purchaseOrderId: po1.id, requisitionId: req.id, number: "LPO-001", status: "APPROVED", total: total1, deliverBy: inDays(-6), createdBy: proc.id, approvedBy: director!.id, approvedAt: inDays(-10) } });

      const year = new Date().getUTCFullYear();
      let seq = (await tx.goodsReceipt.count({ where: { receiptNumber: { startsWith: `GRN-${year}-` } } })) + 1;
      const deliveries: [number, [number, number][]][] = [[-7, [[0, 200], [1, 150], [3, 20]]], [-3, [[0, 150]]]];
      const received = new Map<number, number>();
      for (const [when, items] of deliveries) {
        const receipt = await tx.goodsReceipt.create({ data: { organizationId: orgId, branchId: branch.id, receiptNumber: `GRN-${year}-${String(seq++).padStart(4, "0")}`, purchaseOrderId: po1.id, supplierId: supplier.id, deliveryNote: `DN-${4400 + seq}`, receivedById: store.id, createdAt: inDays(when) } });
        for (const [i, qty] of items) {
          const li = po1.lineItems.find((l) => l.variantId === v(i))!;
          await tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, variantId: v(i), purchaseOrderLineId: li.id, quantityAccepted: qty, unitCost: MATERIALS[i][3] } });
          await tx.purchaseOrderLineItem.update({ where: { id: li.id }, data: { quantityReceived: { increment: qty } } });
          await tx.inventoryTransaction.create({ data: { branchId: branch.id, variantId: v(i), type: "RECEIPT", quantityDelta: qty, referenceId: po1.id, unitCost: MATERIALS[i][3], createdAt: inDays(when) } });
          received.set(i, (received.get(i) ?? 0) + qty);
        }
      }
      const issues: [number, number, "USED" | "WASTED", string | null, number][] = [
        [0, 120, "USED", slab.id, -6], [0, 90, "USED", concrete.id, -4], [0, 70, "USED", concrete.id, -1], [0, 6, "WASTED", null, -4],
        [1, 120, "USED", concrete.id, -5], [3, 18, "USED", concrete.id, -4], [3, 0.5, "WASTED", null, -2],
      ];
      const used = new Map<number, number>();
      for (const [i, qty, kind, bqItemId, when] of issues) {
        const issue = await tx.conMaterialIssue.create({ data: { organizationId: orgId, projectId: pid, variantId: v(i), qty, kind, bqItemId, issuedTo: kind === "USED" ? "Joseph Okoth (foreman)" : null, note: kind === "WASTED" ? "Set in bags after rain" : null, issuedAt: inDays(when), issuedBy: store.id } });
        await tx.inventoryTransaction.create({ data: { branchId: branch.id, variantId: v(i), type: kind === "WASTED" ? "WASTE" : "SITE_ISSUE", quantityDelta: -qty, referenceId: issue.id, createdAt: inDays(when) } });
        used.set(i, (used.get(i) ?? 0) + qty);
      }
      for (const [i, qty] of received) await tx.inventoryItem.create({ data: { branchId: branch.id, variantId: v(i), quantity: qty - (used.get(i) ?? 0) } });

      const lines2: [number, number][] = [[4, 30], [5, 2000]];
      const po2 = await tx.purchaseOrder.create({ data: { organizationId: orgId, branchId: branch.id, supplierId: supplier.id, status: "DRAFT", createdById: proc.id, lineItems: { create: lines2.map(([i, qty]) => ({ variantId: v(i), quantityOrdered: qty, unitCost: MATERIALS[i][3] })) } } });
      await tx.conLpo.create({ data: { organizationId: orgId, projectId: pid, purchaseOrderId: po2.id, number: "LPO-002", status: "AWAITING_APPROVAL", total: lines2.reduce((a, [i, q]) => a + q * MATERIALS[i][3], 0), deliverBy: inDays(5), createdBy: proc.id } });

      const mixer = await tx.conPlant.create({ data: { organizationId: orgId, name: "Concrete mixer 0.5 m³", regNo: "MIX-01", ownership: "OWNED", rateUnit: "DAY", projectId: pid } });
      const excavator = await tx.conPlant.create({ data: { organizationId: orgId, name: "Excavator CAT 320", regNo: "KCX 214Y", ownership: "HIRED", hireRate: 25000, rateUnit: "DAY", supplierId: plantHire.id, projectId: pid } });
      await tx.conPlantLog.createMany({
        data: [
          ...[-12, -11, -10].map((d) => ({ organizationId: orgId, plantId: excavator.id, projectId: pid, date: inDays(d), hours: 8, fuelLitres: 120, fuelCost: 21600, operator: "Plant hire operator" })),
          ...[-6, -5, -4, -3, -1].map((d) => ({ organizationId: orgId, plantId: mixer.id, projectId: pid, date: inDays(d), hours: 6, fuelLitres: 10, fuelCost: 1800, operator: "Kevin Achola" })),
        ],
      });
      console.log(`Seeded materials: 6 items with BQ allowances, REQ-001, LPO-001 (2 deliveries), LPO-002 awaiting approval, 7 issues, 2 plant with logs.`);
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** C5: an approved variation from SI-001, and two certified IPCs (IPC 1 invoiced and paid with withholding certificates; IPC 2 waiting to be invoiced). */
async function seedCommercial(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      const project = await tx.conProject.findFirst({ where: { name: "Uriri Day Secondary Classrooms" } });
      if (!project) return;
      if (await tx.conValuation.count({ where: { projectId: project.id } })) {
        console.log("Valuations already seeded - nothing to do.");
        return;
      }
      const pid = project.id;
      const by = (email: string) => tx.orgUser.findFirst({ where: { user: { email } } });
      const [qs, director, accounts] = await Promise.all([by("qs@uriri.demo"), by("director@uriri.demo"), by("accounts@uriri.demo")]);
      const instruction = await tx.conSiteInstruction.findFirst({ where: { projectId: pid, number: "SI-001" } });
      const variation = await tx.conVariation.create({
        data: { organizationId: orgId, projectId: pid, ref: "VO-001", instructionId: instruction?.id, description: "Raise ring beam by one course to suit revised window heights", amount: 85000, status: "APPROVED", createdBy: qs!.id, approvedBy: director!.id, approvedByName: "Arch. P. Ochieng", approvedAt: inDays(-20) },
      });
      if (instruction) await tx.conSiteInstruction.update({ where: { id: instruction.id }, data: { variationId: variation.id } });
      await tx.conProject.update({ where: { id: pid }, data: { revisedSum: Number(project.contractSum) + 85000 } });

      const items = await tx.conBqItem.findMany({ where: { projectId: pid }, include: { section: true }, orderBy: [{ section: { sortOrder: "asc" } }, { sortOrder: "asc" }] });
      const share = (section: string, part: number) => items.filter((i) => i.section.name === section).map((i) => ({ item: i, qty: Math.round(Number(i.qty) * part * 1000) / 1000 }));
      const plan = [
        { at: -35, lines: [...share("PRELIMINARIES", 1), ...share("SUBSTRUCTURE", 0.8)], vo: 0, mos: 150000 },
        { at: -5, lines: [...share("PRELIMINARIES", 1), ...share("SUBSTRUCTURE", 1), ...share("SUPERSTRUCTURE", 0.6)], vo: 85000, mos: 120000 },
      ];
      const done: { netDue: number }[] = [];
      let lastDeducted = 0;
      for (const [k, v] of plan.entries()) {
        const r = valuation({
          bq: v.lines.map((l) => ({ qtyToDate: l.qty, rate: Number(l.item.rate), qty: Number(l.item.qty) })),
          variations: v.vo ? [{ amountToDate: v.vo, approvedAmount: 85000 }] : [],
          materialsOnSite: v.mos,
          retentionRate: Number(project.retentionRate),
          retentionLimitPercent: Number(project.retentionLimit),
          contractSum: Number(project.contractSum),
          retentionReleasedToDate: 0,
          advanceRecoveryToDate: 0,
          previousCertified: previousCertified(done),
        });
        const val = await tx.conValuation.create({
          data: {
            organizationId: orgId, projectId: pid, number: k + 1, periodEnd: inDays(v.at - 3), status: "CERTIFIED", createdBy: qs!.id, submittedBy: director!.id, submittedAt: inDays(v.at - 2),
            certifiedByName: "QS M. Akinyi (Lakeview Quantity Surveyors)", certifiedRef: `LQS/UDSS/IPC/${k + 1}`, certifiedAt: inDays(v.at), certifiedRecordedBy: qs!.id,
            workToDate: r.workToDate, variationsToDate: r.variationsToDate, materialsOnSite: r.materialsOnSite, grossToDate: r.grossToDate, retentionRate: project.retentionRate,
            retentionDeducted: r.retentionDeducted, retentionReleased: r.retentionReleased, retentionHeld: r.retentionHeld, advanceRecovery: r.advanceRecovery, previousCertified: r.previousCertified, netDue: r.netDue,
            lines: {
              create: [
                ...v.lines.map((l) => ({ organizationId: orgId, bqItemId: l.item.id, qtyToDate: l.qty, amountToDate: Math.round(l.qty * Number(l.item.rate) * 100) / 100 })),
                ...(v.vo ? [{ organizationId: orgId, variationId: variation.id, amountToDate: v.vo }] : []),
              ],
            },
          },
        });
        await tx.conRetentionEntry.create({ data: { organizationId: orgId, projectId: pid, valuationId: val.id, type: "DEDUCT", amount: Math.round((r.retentionDeducted - lastDeducted) * 100) / 100, reason: `IPC ${k + 1}`, createdBy: qs!.id } });
        lastDeducted = r.retentionDeducted;
        done.push({ netDue: r.netDue });
        if (k === 0) {
          const vatAmount = Math.round(r.netDue * 0.16 * 100) / 100;
          const total = Math.round((r.netDue + vatAmount) * 100) / 100;
          const client = await tx.conParty.findUnique({ where: { id: project.clientId! } });
          const saleId = await recordIpcSale(tx as never, { organizationId: orgId, orgUserId: accounts!.id, valuationId: val.id, netAmount: r.netDue, vatRate: 16, vatAmount, client: client ? { name: client.name, kraPin: client.kraPin, phone: client.phone } : null });
          const wht = Math.round(r.netDue * 0.03 * 100) / 100;
          const whtVat = Math.round(r.netDue * 0.02 * 100) / 100;
          await tx.conValuation.update({ where: { id: val.id }, data: { saleId, invoicedAt: inDays(v.at + 1), vatRate: 16, vatAmount, invoiceTotal: total, status: "PAID", paidAt: inDays(v.at + 20) } });
          await tx.conValuationReceipt.createMany({
            data: [
              { organizationId: orgId, valuationId: val.id, kind: "PAYMENT", amount: Math.round((total - wht - whtVat) * 100) / 100, method: "BANK", reference: "EFT/UDSS/0091", receivedAt: inDays(v.at + 20), createdBy: accounts!.id },
              { organizationId: orgId, valuationId: val.id, kind: "WHT", amount: wht, certificateNo: "KRAWHT0026114", receivedAt: inDays(v.at + 20), createdBy: accounts!.id },
              { organizationId: orgId, valuationId: val.id, kind: "WHT_VAT", amount: whtVat, certificateNo: "KRAWHV0019920", receivedAt: inDays(v.at + 20), createdBy: accounts!.id },
            ],
          });
        }
      }
      console.log(`Seeded VO-001 and IPC 1 (paid) and IPC 2 (certified) on ${project.code}.`);
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
