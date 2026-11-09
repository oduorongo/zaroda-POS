import { randomInt, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateTempPassword } from '../../common/crypto/temp-password';
import { ConSetupService } from '../../construction/common/con-setup.service';
import { FREE_PLAN_UNTIL, needsDeviceSubscription } from '../../platform-admin/subscriptions.util';
import { CONSTRUCTION_KIT, Kit, kitLabel, RENTAL_KIT, TRAINING_KITS, TRAINING_TYPES } from './training-kits';

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
const SALE_DAYS = 14;
const TX = { timeout: 120_000, maxWait: 30_000 };
export const TRAINING_EMAIL_DOMAIN = 'training.zarodasolutions.app';

const startOfDay = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY);
};
const siteOf = (v: string | undefined) => (v ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
/** Where a training owner signs in: construction and rentals on their own sites once set, everything else in the back office. */
export const signInUrl = (industryType: string) => {
  const own = industryType === 'CONSTRUCTION' ? siteOf(process.env.CONSTRUCTION_DOMAIN) : industryType === 'RENTAL' ? siteOf(process.env.RENTALS_DOMAIN) : '';
  const site = own || siteOf(process.env.BACKOFFICE_BASE_URL);
  return site ? `https://${site}/login` : null;
};
const pick = <T>(xs: T[]) => xs[randomInt(xs.length)];
const between = (lo: number, hi: number) => lo + randomInt(hi - lo + 1);

export const trainingEmail = (teamId: string, industryType: string) =>
  `${industryType.toLowerCase().replace(/_/g, '-')}.${teamId.replace(/-/g, '').slice(0, 6)}@${TRAINING_EMAIL_DOMAIN}`;

export interface TrainingAccountView {
  industryType: string;
  signInUrl: string | null;
  label: string;
  businessName: string;
  ownerEmail: string;
  organizationId: string;
  passwordSetAt: Date;
  password?: string;
}

/**
 * Training businesses for a sales team: one per business type, with sample data and a shared owner login. They are marked
 * isDemo, never attributed to the team (so they earn no commission), and their plans never fall due.
 */
@Injectable()
export class TrainingAccountsService {
  private readonly conSetup: ConSetupService;

  constructor(private readonly prisma: PrismaService) {
    this.conSetup = new ConSetupService(prisma);
  }

  async list(teamId: string): Promise<TrainingAccountView[]> {
    const rows = await this.prisma.salesTeamTrainingAccount.findMany({
      where: { teamId },
      include: { organization: { select: { name: true } } },
    });
    return TRAINING_TYPES.flatMap((t) => {
      const r = rows.find((x) => x.industryType === t);
      return r ? [{ industryType: t, signInUrl: signInUrl(t), label: kitLabel(t), businessName: r.organization.name, ownerEmail: r.ownerEmail, organizationId: r.organizationId, passwordSetAt: r.passwordSetAt }] : [];
    });
  }

  /** Creates whichever training businesses the team is missing. New passwords are returned once and never stored readable. */
  async ensureForTeam(teamId: string, platformAdminId?: string): Promise<{ accounts: TrainingAccountView[]; failed: string[] }> {
    const team = await this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
    if (!team) throw new NotFoundException('Team not found');
    const have = new Set((await this.prisma.salesTeamTrainingAccount.findMany({ where: { teamId }, select: { industryType: true } })).map((r) => r.industryType));
    const created = new Map<string, string>();
    const failed: string[] = [];
    for (const type of TRAINING_TYPES.filter((t) => !have.has(t))) {
      try {
        created.set(type, await this.createOne(team, type));
      } catch (e) {
        failed.push(type);
        console.error(`Training account ${type} for team ${teamId} failed:`, e);
      }
    }
    if (created.size && platformAdminId) {
      await this.prisma.platformAuditLog.create({ data: { platformAdminId, action: 'sales_team.training_accounts.create', entityType: 'SalesTeam', entityId: teamId } });
    }
    const accounts = (await this.list(teamId)).map((a) => (created.has(a.industryType) ? { ...a, password: created.get(a.industryType) } : a));
    return { accounts, failed };
  }

  async resetPassword(teamId: string, industryType: string, actor: { platformAdminId?: string; agentId?: string }) {
    const row = await this.prisma.salesTeamTrainingAccount.findUnique({ where: { teamId_industryType: { teamId, industryType } } });
    if (!row) throw new NotFoundException('No training account of that type for this team');
    const password = generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${row.organizationId}, true)`;
      await tx.user.update({ where: { email: row.ownerEmail }, data: { passwordHash } });
      await tx.salesTeamTrainingAccount.update({ where: { id: row.id }, data: { passwordSetAt: new Date() } });
      await tx.auditLog.create({
        data: { organizationId: row.organizationId, action: 'training_account.reset_password', entityType: 'User', entityId: row.ownerEmail, after: { by: actor.platformAdminId ? 'platform_admin' : 'team_leader', actorId: actor.platformAdminId ?? actor.agentId ?? null } },
      });
    });
    return { industryType, ownerEmail: row.ownerEmail, password };
  }

  private async createOne(team: { id: string; name: string }, industryType: string): Promise<string> {
    const kit = TRAINING_KITS.find((k) => k.industryType === industryType);
    const base = kit ?? (industryType === 'RENTAL' ? RENTAL_KIT : CONSTRUCTION_KIT);
    const password = generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const ownerEmail = trainingEmail(team.id, industryType);
    const organizationId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      await tx.organization.create({ data: { id: organizationId, name: `${base.businessName} (Training - ${team.name})`, industryType, country: 'KE', isDemo: true } });
      const user = await tx.user.create({ data: { email: ownerEmail, fullName: base.ownerName, passwordHash } });
      const owner = await tx.orgUser.create({ data: { organizationId, userId: user.id, role: Role.OWNER } });
      const branch = await tx.branch.create({ data: { organizationId, name: base.branchName, county: base.county } });
      const terminal = await tx.terminal.create({ data: { branchId: branch.id, deviceLabel: 'Register 1' } });
      if (needsDeviceSubscription(industryType)) {
        const plan = await tx.plan.findUniqueOrThrow({ where: { tier: 'BASIC' } });
        await tx.subscription.create({ data: { organizationId, planId: plan.id, currentPeriodEnd: FREE_PLAN_UNTIL, isTrial: false } });
      }
      await tx.salesTeamTrainingAccount.create({ data: { teamId: team.id, industryType, organizationId, ownerEmail } });

      if (kit) await this.seedShop(tx, organizationId, branch.id, terminal.id, owner.id, kit);
      if (industryType === 'RESTAURANT') await this.seedRestaurant(tx, organizationId, branch.id);
      if (industryType === 'HOTEL') await this.seedHotel(tx, organizationId, branch.id);
      if (industryType === 'SALON') await tx.salonResource.createMany({ data: ['Chair 1 - Esther', 'Chair 2 - Wanjiku', 'Nail station'].map((name) => ({ organizationId, branchId: branch.id, name })) });
      if (industryType === 'RENTAL') await this.seedRental(tx, organizationId);
      if (industryType === 'CONSTRUCTION') await this.seedConstruction(tx, organizationId, owner.id);
    }, TX);
    return password;
  }

  /** Products with stock, customers, and two weeks of completed sales (cash and M-Pesa) so reports have something to show. */
  private async seedShop(tx: Tx, organizationId: string, branchId: string, terminalId: string, ownerId: string, kit: Kit) {
    const categories = [...new Set(kit.products.map((x) => x.category))];
    const catIds = new Map(categories.map((c) => [c, randomUUID()]));
    await tx.category.createMany({ data: categories.map((name) => ({ id: catIds.get(name)!, organizationId, name })) });

    const items = kit.products.map((x, i) => ({ ...x, productId: randomUUID(), variantId: randomUUID(), sku: `TRN-${String(i + 1).padStart(3, '0')}`, sold: 0 }));
    await tx.product.createMany({ data: items.map((x) => ({ id: x.productId, organizationId, categoryId: catIds.get(x.category), name: x.name, baseUnit: x.unit ?? 'each' })) });
    await tx.productVariant.createMany({
      data: items.map((x) => ({ id: x.variantId, productId: x.productId, sku: x.sku, price: x.price, cost: x.cost || null, ...(x.schoolPrice ? { onSchoolList: true, schoolPrice: x.schoolPrice } : {}) })),
    });

    const customerIds = kit.customers.map(() => randomUUID());
    await tx.customer.createMany({ data: kit.customers.map((name, i) => ({ id: customerIds[i], organizationId, name })) });

    const sessions: Prisma.CashierSessionCreateManyInput[] = [];
    const sales: Prisma.SaleCreateManyInput[] = [];
    const lines: Prisma.SaleLineItemCreateManyInput[] = [];
    const payments: Prisma.SalePaymentCreateManyInput[] = [];
    const moves: Prisma.InventoryTransactionCreateManyInput[] = [];
    const [lo, hi] = kit.salesPerDay ?? [4, 8];
    for (let d = -SALE_DAYS; d <= -1; d++) {
      const day = startOfDay(d);
      const sessionId = randomUUID();
      sessions.push({ id: sessionId, terminalId, orgUserId: ownerId, pinStartedAt: new Date(day.getTime() + 5 * 3600_000), pinEndedAt: new Date(day.getTime() + 17 * 3600_000) });
      for (let s = between(lo, hi); s > 0; s--) {
        const saleId = randomUUID();
        const at = new Date(day.getTime() + between(5 * 60, 16 * 60) * 60_000);
        let total = 0;
        const chosen = new Set<number>();
        for (let n = between(1, 3); n > 0; n--) chosen.add(randomInt(items.length));
        for (const i of chosen) {
          const it = items[i];
          const qty = it.price >= 2000 ? 1 : between(1, 3);
          it.sold += qty;
          total += qty * it.price;
          lines.push({ saleId, variantId: it.variantId, quantity: qty, unitPrice: it.price });
          moves.push({ branchId, variantId: it.variantId, type: 'SALE', quantityDelta: -qty, referenceId: saleId, unitCost: it.cost || null, createdAt: at });
        }
        sales.push({ id: saleId, organizationId, branchId, terminalId, cashierSessionId: sessionId, cashierOrgUserId: ownerId, customerId: randomInt(3) === 0 ? pick(customerIds) : null, clientId: `training-${saleId}`, status: 'COMPLETED', total, createdAt: at });
        payments.push({ saleId, method: randomInt(5) < 3 ? PaymentMethod.MPESA : PaymentMethod.CASH, amount: total, createdAt: at });
      }
    }

    const opening = startOfDay(-SALE_DAYS - 1);
    moves.unshift(...items.map((it) => ({ branchId, variantId: it.variantId, type: 'RECEIPT' as const, quantityDelta: it.stock + it.sold, unitCost: it.cost || null, createdAt: opening })));
    await tx.inventoryItem.createMany({ data: items.map((it) => ({ branchId, variantId: it.variantId, quantity: it.stock, lowStockThreshold: Math.max(2, Math.round(it.stock / 8)) })) });
    await tx.cashierSession.createMany({ data: sessions });
    await tx.sale.createMany({ data: sales });
    await tx.saleLineItem.createMany({ data: lines });
    await tx.salePayment.createMany({ data: payments });
    await tx.inventoryTransaction.createMany({ data: moves });
  }

  private async seedRestaurant(tx: Tx, organizationId: string, branchId: string) {
    await tx.restaurantTable.createMany({
      data: [['Table 1', 4], ['Table 2', 4], ['Table 3', 2], ['Table 4', 6], ['Patio 1', 4], ['Patio 2', 8]].map(([label, seats]) => ({ organizationId, branchId, label: String(label), seats: Number(seats) })),
    });
  }

  private async seedHotel(tx: Tx, organizationId: string, branchId: string) {
    const types = [
      { name: 'Standard Single', price: 2500, guests: 1, rooms: ['101', '102', '103'] },
      { name: 'Deluxe Double', price: 4500, guests: 2, rooms: ['201', '202', '203'] },
      { name: 'Family Suite', price: 8000, guests: 4, rooms: ['301', '302'] },
    ];
    for (const t of types) {
      const type = await tx.hotelRoomType.create({ data: { organizationId, name: t.name, pricePerNight: t.price, maxGuests: t.guests, quantity: t.rooms.length, description: `${t.name} with en-suite bathroom and free Wi-Fi` } });
      await tx.hotelRoom.createMany({ data: t.rooms.map((number) => ({ organizationId, branchId, roomTypeId: type.id, number, floor: number[0] })) });
    }
  }

  private async seedRental(tx: Tx, organizationId: string) {
    // No phone numbers on made-up people: a reminder or receipt text must never reach a real number.
    const tenants = RENTAL_KIT.tenants.map((name) => ({ id: randomUUID(), organizationId, name }));
    await tx.rentalTenant.createMany({ data: tenants });
    let t = 0;
    for (const prop of RENTAL_KIT.properties) {
      const property = await tx.rentalProperty.create({ data: { organizationId, name: prop.name, address: prop.address } });
      for (const [label, rent] of prop.units) {
        const tenant = tenants[t];
        const unit = await tx.rentalUnit.create({ data: { organizationId, propertyId: property.id, label, monthlyRent: rent, depositAmount: rent, status: tenant ? 'OCCUPIED' : 'VACANT' } });
        if (tenant) {
          await tx.rentalLease.create({ data: { organizationId, unitId: unit.id, tenantId: tenant.id, startDate: startOfDay(-30 * between(2, 10)), monthlyRent: rent, depositAmount: rent, dueDay: 5 } });
          t++;
        }
      }
    }
  }

  private async seedConstruction(tx: Tx, organizationId: string, ownerId: string) {
    await this.conSetup.ensure(tx, organizationId);
    await tx.conSubscription.update({ where: { organizationId }, data: { planCode: 'CON_CONTRACTOR', status: 'ACTIVE', currentPeriodEnd: FREE_PLAN_UNTIL } });
    await tx.conProject.createMany({
      data: CONSTRUCTION_KIT.projects.map((x) => ({
        organizationId,
        code: x.code,
        name: x.name,
        worksClass: x.worksClass,
        contractSum: x.contractSum,
        location: x.location,
        county: CONSTRUCTION_KIT.county,
        status: x.status,
        startDate: startOfDay(x.startIn),
        completionDate: startOfDay(x.finishIn),
        createdBy: ownerId,
      })),
    });
  }
}
