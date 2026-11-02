import { ConDocType, ConRoleCode, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { ConSetupService } from "../src/construction/common/con-setup.service";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { recordIpcSale } from "../src/construction/commercial/ipc-sale";
import { previousCertified, valuation } from "../src/construction/commercial/valuation.util";
import { casualDeductions, payrollRates, PAYROLL_KEYS } from "../src/construction/payroll/payroll.util";
import { dayValue } from "../src/construction/site/site.util";
import { nextCode } from "../src/construction/projects/projects.util";
import { payoutFee } from "../src/construction/plans/con-addons.util";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + n * DAY);

/**
 * Demo construction tenant "Uriri Builders Ltd" (NCA5 Building, NCA6 Roads) on the Contractor plan, with staff in construction
 * roles and a compliance vault showing green, amber and red documents. Dev/demo only. Run after the construction migration:
 *   npx ts-node prisma/seed-construction.ts
 * Sign in with director@uriri.demo / password123 (also compliance@, qs@, accounts@, pm@, site@, procurement@, store@).
 * Portal (emailed code; shown on screen when email is not set up): client@, cqs@, arch@, sub@uriri.demo.
 * Three projects: PRJ-001 (classrooms, on programme), a smaller market job running late, and an 11 kV REREC power line (C9).
 */
async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: "Uriri Builders Ltd", industryType: "CONSTRUCTION" } });
  const orgId = existing?.id ?? (await seedCompany());
  await seedProject(orgId);
  await seedSite(orgId);
  await seedMaterials(orgId);
  await seedCommercial(orgId);
  await seedPayrollPortal(orgId);
  await seedSecondProject(orgId);
  await seedAddons(orgId);
  await seedPowerLine(orgId);
}

/** C8: an SMS bundle bought, last month's payout fees invoiced (unpaid), and a branch office ready for an Enterprise upgrade. */
async function seedAddons(orgId: string) {
  const bands = (await prisma.conPayoutFeeBand.findMany()).map((b) => ({ upTo: b.upTo === null ? null : Number(b.upTo), darajaCost: Number(b.darajaCost), markup: Number(b.markup) }));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
    if (await tx.conFeeInvoice.count()) {
      console.log("Add-ons already seeded - nothing to do.");
      return;
    }
    const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    const accounts = await tx.orgUser.findFirst({ where: { user: { email: "accounts@uriri.demo" } } });
    await tx.conSubscriptionPayment.create({
      data: { organizationId: orgId, planCode: sub.planCode, cycle: "MONTHLY", months: 0, amount: 500, status: "PAID", phone: "254711000001", receipt: "SKD7Q2M4LP", paidAt: inDays(-12), purpose: "SMS", details: { bundleCode: "SMS_500", sms: 500 }, createdBy: accounts?.id },
    });
    await tx.conSubscription.update({ where: { id: sub.id }, data: { smsCredits: { increment: 500 } } });

    const lm = new Date(Date.now() + 3 * 3600_000);
    lm.setUTCDate(1);
    lm.setUTCMonth(lm.getUTCMonth() - 1);
    const month = lm.toISOString().slice(0, 7);
    const project = await tx.conProject.findFirst({ where: { name: "Uriri Day Secondary Classrooms" } });
    const charges = [2400, 4800, 12600].map((net, i) => ({ ...payoutFee(bands, net), net, i }));
    const invoice = await tx.conFeeInvoice.create({ data: { organizationId: orgId, periodMonth: month, total: charges.reduce((a, c) => a + c.amount, 0) } });
    await tx.conFeeCharge.createMany({
      data: charges.map((c) => ({ organizationId: orgId, kind: "PAYOUT", sourceId: `seed-payout:${orgId}:${c.i}`, projectId: project?.id ?? null, amount: c.amount, darajaCost: c.darajaCost, markup: c.markup, description: `M-Pesa wage payout of KES ${c.net.toLocaleString("en-KE")}`, periodMonth: month, invoiceId: invoice.id })),
    });
    await tx.conOffice.create({ data: { organizationId: orgId, name: "Kisumu office", county: "Kisumu" } });
    console.log(`Seeded 500 texts bought, ${month} payout fees invoice (KES ${Number(invoice.total)}, unpaid) and a Kisumu office (Enterprise only).`);
  });
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

/** C6: payroll rates in settings, a paid pay run for the first three muster days, a subcontract, and four portal users. */
async function seedPayrollPortal(orgId: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      await new ConSetupService(prisma as unknown as PrismaService).ensure(tx, orgId);
      await tx.conTaxSetting.updateMany({ where: { key: "NSSF", threshold: null }, data: { threshold: 72000 } });
      await tx.conTaxSetting.updateMany({ where: { key: "SHIF", threshold: null }, data: { threshold: 300 } });
      const project = await tx.conProject.findFirst({ where: { name: "Uriri Day Secondary Classrooms" } });
      if (!project) return;
      if (await tx.conPortalUser.count()) {
        console.log("Payroll and portal already seeded - nothing to do.");
        return;
      }
      const pid = project.id;
      const by = (email: string) => tx.orgUser.findFirst({ where: { user: { email } } });
      const [accounts, director, qsUser] = await Promise.all([by("accounts@uriri.demo"), by("director@uriri.demo"), by("qs@uriri.demo")]);

      const settings = await tx.conTaxSetting.findMany({ where: { key: { in: PAYROLL_KEYS }, active: true } });
      const rates = payrollRates(new Map(settings.map((r) => [r.key, { rate: Number(r.rate), threshold: r.threshold === null ? null : Number(r.threshold) }])));
      const muster = await tx.conMuster.findMany({ where: { projectId: pid, date: { gte: inDays(-6), lte: inDays(-4) }, status: { not: "ABSENT" } }, include: { worker: true } });
      const byWorker = new Map<string, { days: number; rate: number }>();
      for (const m of muster) {
        const w = byWorker.get(m.workerId) ?? { days: 0, rate: Number(m.worker.dailyRate) };
        w.days += dayValue(m.status);
        byWorker.set(m.workerId, w);
      }
      const lines = Array.from(byWorker.entries()).map(([workerId, w], i) => {
        const gross = Math.round(w.days * w.rate * 100) / 100;
        const d = casualDeductions(gross, 3, rates);
        return { organizationId: orgId, workerId, days: w.days, dailyRate: w.rate, gross, ...d, status: "PAID" as const, method: i % 3 === 0 ? ("CASH" as const) : ("MPESA_MANUAL" as const), reference: i % 3 === 0 ? "PV-0042" : `SJ${String(4471 + i)}XK`, paidAt: inDays(-3), paidBy: accounts!.id, smsSentAt: inDays(-3) };
      });
      if (lines.length) {
        const sum = (k: "gross" | "deductions" | "net") => Math.round(lines.reduce((a, l) => a + l[k], 0) * 100) / 100;
        await tx.conPayrollRun.create({
          data: {
            organizationId: orgId, projectId: pid, number: "PAY-001", periodStart: inDays(-6), periodEnd: inDays(-4), status: "PAID", workers: lines.length, gross: sum("gross"), deductions: sum("deductions"), net: sum("net"),
            createdBy: accounts!.id, approvedBy: director!.id, approvedAt: inDays(-3), paidAt: inDays(-3), lines: { create: lines },
          },
        });
      }

      const sub = await tx.conParty.create({ data: { organizationId: orgId, kind: "SUBCONTRACTOR", name: "Nyanza Plumbing Works Ltd", contactPerson: "Mr. S. Odhiambo", phone: "0711000005", email: "sub@uriri.demo" } });
      await tx.conProjectParty.create({ data: { organizationId: orgId, projectId: pid, partyId: sub.id, role: "SUBCONTRACTOR" } });
      const sc = await tx.conSubcontract.create({ data: { organizationId: orgId, projectId: pid, partyId: sub.id, ref: nextCode("SC", (await tx.conSubcontract.findMany({ where: { projectId: pid }, select: { ref: true } })).map((r) => r.ref)), scope: "Plumbing, drainage and rainwater goods", sum: 1200000, createdBy: qsUser!.id } });
      await tx.conSubValuation.create({ data: { organizationId: orgId, subcontractId: sc.id, number: 1, grossToDate: 320000, retention: 32000, previousPaid: 0, netDue: 288000, status: "PAID", createdBy: qsUser!.id, approvedBy: director!.id, approvedAt: inDays(-10), paidAt: inDays(-8), paymentRef: "EFT/NPW/0013" } });

      const parties = await tx.conParty.findMany({ where: { kind: { in: ["CLIENT", "QS", "ARCHITECT"] } } });
      const party = (kind: string) => parties.find((p) => p.kind === kind && (kind !== "CLIENT" || p.id === project.clientId))?.id ?? null;
      const people: { email: string; name: string; role: ConRoleCode; partyId: string | null }[] = [
        { email: "client@uriri.demo", name: "The Principal, Uriri Day Secondary", role: "CON_CLIENT", partyId: party("CLIENT") },
        { email: "cqs@uriri.demo", name: "QS M. Akinyi", role: "CON_CONSULTANT_QS", partyId: party("QS") },
        { email: "arch@uriri.demo", name: "Arch. P. Ochieng", role: "CON_CONSULTANT_ARCH", partyId: party("ARCHITECT") },
        { email: "sub@uriri.demo", name: "Nyanza Plumbing Works", role: "CON_SUBCONTRACTOR", partyId: sub.id },
      ];
      for (const p of people) {
        await tx.conPortalUser.create({ data: { organizationId: orgId, ...p, invitedBy: director!.id, access: { create: [{ organizationId: orgId, projectId: pid }] } } });
      }
      console.log(`Seeded PAY-001 (${lines.length} workers, paid), ${sc.ref} and 4 portal users on ${project.code}.`);
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

/** C7: a second, smaller job running late, so the Director overview and reports compare projects. */
async function seedSecondProject(orgId: string) {
  const name = "Oyani Market Sheds";
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.conProject.findFirst({ where: { name } })) {
        console.log(`${name} already exists - nothing to do.`);
        return;
      }
      const pm = await tx.orgUser.findFirst({ where: { user: { email: "pm@uriri.demo" } } });
      const client = await tx.conParty.create({ data: { organizationId: orgId, kind: "CLIENT", name: "County Government of Migori - Trade Department", contactPerson: "Chief Officer, Trade", phone: "0711000020" } });
      const codes = (await tx.conProject.findMany({ select: { code: true } })).map((p) => p.code);
      const bq: [string, [string, string, number, number][]][] = [
        ["Substructure", [["Excavate for strip foundations", "m3", 120, 850], ["Concrete class 20 in foundations", "m3", 45, 14500], ["Hardcore filling, 200mm", "m2", 600, 420]]],
        ["Steel sheds", [["Structural steel portal frames", "kg", 18000, 165], ["Roofing sheets, gauge 28, pre-painted", "m2", 1400, 980], ["Concrete floor slab 150mm", "m2", 600, 2350]]],
      ];
      const total = bq.flatMap(([, items]) => items).reduce((a, [, , qty, rate]) => a + qty * rate, 0);
      const project = await tx.conProject.create({
        data: {
          organizationId: orgId, code: nextCode("PRJ", codes), name, clientId: client.id, worksClass: "BUILDING", contractSum: total, formOfContract: "PPADA",
          startDate: inDays(-150), completionDate: inDays(10), dlpMonths: 6, county: "Migori", location: "Oyani market", status: "ACTIVE",
        },
      });
      const pid = project.id;
      if (pm) await tx.conProjectMember.create({ data: { organizationId: orgId, projectId: pid, orgUserId: pm.id, role: "CON_PROJECT_MGR" } });
      await tx.conProjectPermit.create({ data: { organizationId: orgId, projectId: pid, type: "NCA_PROJECT_REG", status: "APPROVED", refNo: "NCA/PR/2026/49077", issuedAt: inDays(-160) } });
      const ms: [string, number, number, number][] = [
        ["Site clearance and setting out", -150, -135, 100],
        ["Foundations and slab", -134, -80, 100],
        ["Steel frames", -79, -30, 70],
        ["Roofing and handover", -29, 10, 10],
      ];
      await tx.conMilestone.createMany({ data: ms.map(([n, st, en, pc], i) => ({ organizationId: orgId, projectId: pid, name: n, startDate: inDays(st), endDate: inDays(en), percentComplete: pc, sortOrder: i })) });
      for (const [si, [sectionName, items]] of bq.entries()) {
        const section = await tx.conBqSection.create({ data: { organizationId: orgId, projectId: pid, code: `BILL ${si + 1}`, name: sectionName, sortOrder: si } });
        await tx.conBqItem.createMany({ data: items.map(([description, unit, qty, rate], ii) => ({ organizationId: orgId, projectId: pid, sectionId: section.id, code: String.fromCharCode(65 + ii), description, unit, qty, rate, amount: qty * rate, sortOrder: ii })) });
      }
      await tx.conToolboxTalk.create({ data: { organizationId: orgId, projectId: pid, date: inDays(-45), topic: "Working at height on steel frames", heldBy: pm?.id } });
      await tx.conIncident.create({
        data: { organizationId: orgId, projectId: pid, occurredAt: inDays(-40), severity: "LOST_TIME", description: "Fitter struck by a swinging purlin while lifting; bruised shoulder, off work 3 days.", actionTaken: "Tag lines used for every lift", reportDueAt: new Date(inDays(-40).getTime() + 7 * DAY), reportedToDoshs: true, reportedAt: inDays(-36), doshsRef: "DOSHS/MGR/2026/311", createdBy: pm?.id },
      });
      console.log(`Seeded ${project.code} ${name} (behind programme).`);
    },
    { timeout: 60_000 },
  );
}

/** C9 (docs/construction/07): an 11 kV REREC line with an A1 EPRA licence, sections and progress, wayleaves, crossings, free-issue materials and pole records. */
async function seedPowerLine(orgId: string) {
  const name = "Rongo-Kamagambo 11kV Line Extension";
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;
      if (await tx.conProject.findFirst({ where: { name } })) {
        console.log(`${name} already exists - nothing to do.`);
        return;
      }
      const by = async (email: string) => tx.orgUser.findFirst({ where: { user: { email } } });
      const [pm, site, store, comp] = await Promise.all([by("pm@uriri.demo"), by("site@uriri.demo"), by("store@uriri.demo"), by("compliance@uriri.demo")]);
      await tx.conCompanyRegistration.upsert({
        where: { organizationId_worksClass: { organizationId: orgId, worksClass: "ELEC_MECH" } },
        create: { organizationId: orgId, worksClass: "ELEC_MECH", ncaCategory: 4, regNo: "NCA/EM/4/2026/01188", registeredAt: inDays(-400), licenceExpiresAt: inDays(240), createdBy: comp?.id },
        update: {},
      });
      await tx.conEpraClass.createMany({
        data: [
          { organizationId: orgId, code: "A1", label: "Class A1 (high voltage installations)", anyVoltage: true },
          { organizationId: orgId, code: "A2", label: "Class A2", anyVoltage: false },
          { organizationId: orgId, code: "B", label: "Class B", anyVoltage: false },
          { organizationId: orgId, code: "C1", label: "Class C1", anyVoltage: false },
          { organizationId: orgId, code: "C2", label: "Class C2", anyVoltage: false },
        ],
        skipDuplicates: true,
      });
      await tx.conComplianceDoc.create({ data: { organizationId: orgId, type: ConDocType.EPRA_LICENCE, epraClass: "A1", title: "EPRA electrical contractor licence", refNo: "EPRA/ECL/A1/2026/0457", issuedAt: inDays(-200), expiresAt: inDays(165), createdBy: comp?.id } });
      if (site) await tx.conStaffLicence.create({ data: { organizationId: orgId, orgUserId: site.id, licenceClass: "Electrician A1", licenceNo: "EPRA/EW/A1/88214", expiresAt: inDays(45), createdBy: comp?.id } });

      const client = await tx.conParty.create({ data: { organizationId: orgId, kind: "CLIENT", name: "Rural Electrification and Renewable Energy Corporation (REREC)", contactPerson: "Regional Engineer, Nyanza", phone: "0711000030" } });
      const codes = (await tx.conProject.findMany({ select: { code: true } })).map((p) => p.code);
      const bq: [string, string, number, number][] = [
        ["Survey, pegging and wayleave tracing", "km", 9, 38000],
        ["Erect 11m wooden poles (client-supplied)", "no", 120, 6500],
        ["Install stays complete", "no", 60, 4200],
        ["String 100mm2 ACSR conductor, 3 phase", "km", 9, 210000],
        ["Install 100 kVA pole-mounted transformer", "no", 3, 145000],
        ["Service connections", "no", 80, 3500],
      ];
      const total = bq.reduce((a, [, , q, r]) => a + q * r, 0);
      const project = await tx.conProject.create({
        data: {
          organizationId: orgId, code: nextCode("PRJ", codes), name, clientId: client.id, worksClass: "ELEC_MECH", voltageKv: 11, contractSum: total, formOfContract: "PPADA",
          startDate: inDays(-40), completionDate: inDays(80), dlpMonths: 12, county: "Migori", location: "Rongo to Kamagambo", lat: -0.7584, lng: 34.5986, status: "ACTIVE",
        },
      });
      const pid = project.id;
      const members: [typeof pm, "CON_PROJECT_MGR" | "CON_SITE_SUPERVISOR" | "CON_STOREKEEPER"][] = [[pm, "CON_PROJECT_MGR"], [site, "CON_SITE_SUPERVISOR"], [store, "CON_STOREKEEPER"]];
      for (const [u, role] of members) if (u) await tx.conProjectMember.create({ data: { organizationId: orgId, projectId: pid, orgUserId: u.id, role } });
      const bill = await tx.conBqSection.create({ data: { organizationId: orgId, projectId: pid, code: "BILL 1", name: "11 kV line works", sortOrder: 0 } });
      await tx.conBqItem.createMany({ data: bq.map(([description, unit, qty, rate], i) => ({ organizationId: orgId, projectId: pid, sectionId: bill.id, code: String.fromCharCode(65 + i), description, unit, qty, rate, amount: qty * rate, sortOrder: i })) });
      await tx.conProjectPermit.create({ data: { organizationId: orgId, projectId: pid, type: "NCA_PROJECT_REG", status: "APPROVED", refNo: "NCA/PR/2026/50231", issuedAt: inDays(-45) } });

      const sections = [
        { code: "S1", name: "Rongo town to Ogembo junction", fromKm: 0, toKm: 3, targetPoles: 40, targetStays: 20, targetConductorKm: 3, targetTransformers: 1, targetServices: 30 },
        { code: "S2", name: "Ogembo junction to Nyarach", fromKm: 3, toKm: 6, targetPoles: 40, targetStays: 20, targetConductorKm: 3, targetTransformers: 1, targetServices: 25 },
        { code: "S3", name: "Nyarach to Kamagambo", fromKm: 6, toKm: 9, targetPoles: 40, targetStays: 20, targetConductorKm: 3, targetTransformers: 1, targetServices: 25 },
      ];
      const made = [];
      for (const sec of sections) made.push(await tx.conProjectSection.create({ data: { organizationId: orgId, projectId: pid, ...sec } }));
      const [s1, s2, s3] = made;
      for (let d = 7; d >= 1; d--) {
        await tx.conSectionProgress.create({ data: { organizationId: orgId, projectId: pid, sectionId: s1.id, date: inDays(-d), poles: 5, stays: 2, conductorKm: d <= 4 ? 0.5 : 0, transformers: d === 2 ? 1 : 0, services: d <= 2 ? 6 : 0, crew: "Crew A (Ouma)", createdBy: site?.id } });
        if (d <= 3) await tx.conSectionProgress.create({ data: { organizationId: orgId, projectId: pid, sectionId: s2.id, date: inDays(-d), poles: 4, stays: 2, conductorKm: 0, crew: "Crew B", createdBy: site?.id } });
      }

      const wayleaves: [string, string, number, "AGREED" | "PAID" | "PENDING" | "REFUSED", number | null, typeof s1][] = [
        ["Peter Odhiambo", "MIGORI/RONGO/1102", 0.6, "PAID", 12000, s1],
        ["Grace Akinyi", "MIGORI/RONGO/1147", 1.4, "AGREED", 9000, s1],
        ["Rongo Primary School (BOM)", "MIGORI/RONGO/1190", 2.2, "AGREED", 0, s1],
        ["Samuel Owino", "MIGORI/OGEMBO/0331", 3.8, "PENDING", null, s2],
        ["Esther Atieno", "MIGORI/OGEMBO/0359", 4.9, "REFUSED", null, s2],
        ["Joseph Okoth", "MIGORI/NYARACH/0072", 6.7, "PENDING", null, s3],
      ];
      await tx.conWayleave.createMany({
        data: wayleaves.map(([landowner, parcelNo, km, status, comp2, sec], i) => ({ organizationId: orgId, projectId: pid, sectionId: sec.id, landowner, phone: `07110003${String(10 + i)}`, parcelNo, chainageKm: km, status, compensation: comp2, agreedAt: status === "AGREED" || status === "PAID" ? inDays(-30 + i) : null, notes: status === "REFUSED" ? "Re-route around the homestead (survey to revise)" : null, createdBy: pm?.id })),
      });
      await tx.conCrossing.createMany({
        data: [
          { organizationId: orgId, projectId: pid, sectionId: s1.id, kind: "ROAD", authority: "KeNHA", refNo: "KeNHA/WL/MGR/2026/118", status: "APPROVED", approvedAt: inDays(-35), expiresAt: inDays(40), createdBy: pm?.id },
          { organizationId: orgId, projectId: pid, sectionId: s3.id, kind: "RIVER", authority: "WRA (Water Resources Authority)", refNo: null, status: "PENDING", notes: "River Kuja crossing, application lodged", createdBy: pm?.id },
        ],
      });

      const items = [
        { code: "POLE-11M", description: "11m treated wooden pole", unit: "no", received: 80, issued: 55 },
        { code: "ACSR-100", description: "100mm2 ACSR conductor", unit: "km", received: 9, issued: 2.5 },
        { code: "TX-100KVA", description: "100 kVA 11/0.415 kV transformer", unit: "no", received: 2, issued: 1 },
      ];
      for (const it of items) {
        const item = await tx.conClientItem.create({ data: { organizationId: orgId, projectId: pid, code: it.code, description: it.description, unit: it.unit } });
        await tx.conClientMaterialMove.create({ data: { organizationId: orgId, projectId: pid, itemId: item.id, kind: "RECEIVED", quantity: it.received, moveDate: inDays(-20), reference: "REREC-DN-2026-0412", createdBy: store?.id } });
        await tx.conClientMaterialMove.create({ data: { organizationId: orgId, projectId: pid, itemId: item.id, kind: "ISSUED", quantity: it.issued, sectionId: s1.id, moveDate: inDays(-6), createdBy: store?.id } });
      }

      const poles = Array.from({ length: 35 }, (_, i) => ({
        organizationId: orgId, projectId: pid, sectionId: i < 27 ? s1.id : s2.id, kind: "POLE" as const, tag: `P-${String(i + 1).padStart(3, "0")}`, spec: "11m treated wooden pole",
        lat: Number((-0.7584 - i * 0.00065).toFixed(6)), lng: Number((34.5986 + i * 0.00071).toFixed(6)), installedAt: inDays(-7 + Math.floor(i / 5)), createdBy: site?.id,
      }));
      await tx.conLineAsset.createMany({ data: [...poles, { organizationId: orgId, projectId: pid, sectionId: s1.id, kind: "TRANSFORMER", tag: "TX-01", serialNo: "ABB-100K-55821", spec: "100 kVA 11/0.415 kV pole-mounted", lat: -0.7712, lng: 34.6123, installedAt: inDays(-2), createdBy: site?.id }] });
      console.log(`Seeded ${project.code} ${name}: A1 EPRA licence, 3 sections with a week of progress, 6 wayleaves, 2 crossings, 3 free-issue items, 35 poles and a transformer.`);
    },
    { timeout: 60_000 },
  );
}
