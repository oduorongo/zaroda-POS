import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InventoryTxnType, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { FarmContext, hasFarmRole } from './farm-access';
import { addDays, asDate, dayOf, todayKey } from './farm-livestock.util';
import { LedgerEntry, aging, overLimit, statement, tillShortfall } from './farm-sales.util';
import { BuyerDto, BuyerPaymentDto, DeliveryDto, ProductTagsDto } from './dto/sales.dto';
import { VoidDto } from './dto/livestock.dto';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const SELLING = new Set<string>([InventoryTxnType.SALE, InventoryTxnType.ONLINE_SALE, InventoryTxnType.CREDIT_SALE]);
const TTL_MS = 60_000;

/** Zaroda Shamba F6 sales: buyers on credit (co-ops, hotels, schools), deliveries, payments, statements, enterprise tags. */
@Injectable()
export class FarmSalesService {
  private readonly logger = new Logger(FarmSalesService.name);
  private static readonly farmType = new Map<string, { farm: boolean; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly audit: AuditLogService,
  ) {}

  private async stockBranch(tx: TenantTx): Promise<string> {
    const s = await tx.farmProduceSettings.findFirst({ select: { branchId: true } });
    const id = s?.branchId ?? (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
    if (!id) throw new BadRequestException('The farm has no branch to keep stock in');
    return id;
  }

  private async entries(tx: TenantTx, buyerIds: string[]): Promise<Map<string, LedgerEntry[]>> {
    const [deliveries, payments] = await Promise.all([
      tx.farmDelivery.findMany({ where: { buyerId: { in: buyerIds }, voidedAt: null }, select: { buyerId: true, date: true, amount: true } }),
      tx.farmBuyerPayment.findMany({ where: { buyerId: { in: buyerIds }, voidedAt: null }, select: { buyerId: true, date: true, amount: true } }),
    ]);
    const map = new Map<string, LedgerEntry[]>(buyerIds.map((id) => [id, []]));
    for (const d of deliveries) map.get(d.buyerId)!.push({ date: dayOf(d.date), kind: 'DELIVERY', amount: n(d.amount) });
    for (const p of payments) map.get(p.buyerId)!.push({ date: dayOf(p.date), kind: 'PAYMENT', amount: n(p.amount) });
    return map;
  }

  // ── Buyers ──────────────────────────────────────────────────────────────

  /** Buyers with what each owes, by age, and whether it is past its limit. */
  listBuyers(all = false) {
    return this.tenantPrisma.run(async (tx) => {
      const buyers = await tx.farmBuyer.findMany({ where: all ? {} : { active: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      const map = await this.entries(tx, buyers.map((b) => b.id));
      const today = todayKey();
      return buyers.map((b) => {
        const a = aging(map.get(b.id) ?? [], today);
        const limit = b.creditLimit === null ? null : n(b.creditLimit);
        return { ...b, creditLimit: limit, ...a, overLimit: limit !== null && a.owed > limit };
      });
    });
  }

  saveBuyer(dto: BuyerDto, id?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const before = id ? await tx.farmBuyer.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Buyer not found');
      const data = {
        name: dto.name.trim(), kind: dto.kind ?? before?.kind ?? 'OTHER', phone: dto.phone?.trim() || null, email: dto.email?.trim().toLowerCase() || null, kraPin: dto.kraPin?.trim().toUpperCase() || null,
        memberNo: dto.memberNo?.trim() || null, creditLimit: dto.creditLimit === undefined ? before?.creditLimit ?? null : dto.creditLimit, termsDays: dto.termsDays === undefined ? before?.termsDays ?? null : dto.termsDays,
        notes: dto.notes?.trim() || null, active: dto.active ?? before?.active ?? true,
      };
      const b = id ? await tx.farmBuyer.update({ where: { id }, data }) : await tx.farmBuyer.create({ data: { organizationId, ...data } });
      await this.audit.logInTx(tx, { action: id ? 'farm.buyer_updated' : 'farm.buyer_added', entityType: 'FarmBuyer', entityId: b.id, before: before ?? undefined, after: b });
      return b;
    });
  }

  buyerStatement(id: string, from?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const b = await tx.farmBuyer.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Buyer not found');
      const start = from ?? addDays(todayKey(), -89);
      const [deliveries, payments] = await Promise.all([
        tx.farmDelivery.findMany({ where: { buyerId: id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
        tx.farmBuyerPayment.findMany({ where: { buyerId: id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      ]);
      const variants = await tx.productVariant.findMany({ where: { id: { in: [...new Set(deliveries.map((d) => d.variantId))] } }, include: { product: { select: { name: true, baseUnit: true } } } });
      const live: LedgerEntry[] = [
        ...deliveries.filter((d) => !d.voidedAt).map((d) => ({ date: dayOf(d.date), kind: 'DELIVERY' as const, amount: n(d.amount) })),
        ...payments.filter((p) => !p.voidedAt).map((p) => ({ date: dayOf(p.date), kind: 'PAYMENT' as const, amount: n(p.amount) })),
      ];
      const st = statement(live, start);
      const label = (vid: string) => variants.find((v) => v.id === vid);
      return {
        buyer: { ...b, creditLimit: b.creditLimit === null ? null : n(b.creditLimit) },
        from: start,
        to: todayKey(),
        opening: st.opening,
        closing: st.closing,
        aging: aging(live, todayKey()),
        deliveries: deliveries
          .filter((d) => dayOf(d.date) >= start)
          .map((d) => ({ ...d, quantity: n(d.quantity), unitPrice: n(d.unitPrice), amount: n(d.amount), product: label(d.variantId)?.product.name ?? '', unit: label(d.variantId)?.product.baseUnit ?? '' })),
        payments: payments.filter((p) => dayOf(p.date) >= start).map((p) => ({ ...p, amount: n(p.amount) })),
        lines: st.lines,
      };
    });
  }

  // ── Deliveries and payments ─────────────────────────────────────────────

  /** Produce delivered on credit: leaves stock (so withheld milk cannot go), owed by the buyer. Past the limit needs a farm manager. */
  recordDelivery(farm: FarmContext, dto: DeliveryDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      const buyer = await tx.farmBuyer.findUnique({ where: { id: dto.buyerId } });
      if (!buyer || !buyer.active) throw new BadRequestException('That buyer was not found');
      const v = await tx.productVariant.findUnique({ where: { id: dto.variantId } });
      if (!v) throw new BadRequestException('That product was not found');
      const unitPrice = dto.unitPrice ?? n(v.price);
      const amount = r2(dto.quantity * unitPrice);
      const owed = aging((await this.entries(tx, [buyer.id])).get(buyer.id) ?? [], todayKey()).owed;
      const limit = buyer.creditLimit === null ? null : n(buyer.creditLimit);
      const past = overLimit(owed, amount, limit);
      if (past && !hasFarmRole(farm, ['FARM_MANAGER'])) {
        throw new ForbiddenException(`${buyer.name} owes KES ${owed.toLocaleString('en-KE')} and its limit is KES ${limit!.toLocaleString('en-KE')}. A farm manager must approve going past it.`);
      }
      const tag = await tx.farmProductTag.findFirst({ where: { variantId: v.id } });
      const branchId = await this.stockBranch(tx);
      const d = await tx.farmDelivery.create({
        data: {
          organizationId, buyerId: buyer.id, date: asDate(dto.date), session: dto.session ?? null, variantId: v.id, quantity: dto.quantity, unitPrice, amount, enterpriseId: tag?.enterpriseId ?? null,
          slipNo: dto.slipNo?.trim() || null, stockBranchId: branchId, overLimit: past, createdBy: orgUserId,
        },
      });
      await this.inventory.recordInTx(tx, { branchId, variantId: v.id, type: InventoryTxnType.CREDIT_SALE, quantityDelta: -dto.quantity, referenceId: d.id });
      await this.audit.logInTx(tx, { action: past ? 'farm.delivery_over_limit_approved' : 'farm.delivery_recorded', entityType: 'FarmDelivery', entityId: d.id, after: { ...d, owedBefore: owed } });
      return { ...d, quantity: dto.quantity, unitPrice, amount, owed: r2(owed + amount) };
    });
  }

  listDeliveries(from: string, to: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.farmDelivery.findMany({ where: { date: { gte: asDate(from), lte: asDate(to) } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
      const [buyers, variants] = await Promise.all([
        tx.farmBuyer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.buyerId))] } }, select: { id: true, name: true } }),
        tx.productVariant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.variantId))] } }, include: { product: { select: { name: true, baseUnit: true } } } }),
      ]);
      return rows.map((r) => ({
        ...r, quantity: n(r.quantity), unitPrice: n(r.unitPrice), amount: n(r.amount), buyer: buyers.find((b) => b.id === r.buyerId)?.name ?? '',
        product: variants.find((v) => v.id === r.variantId)?.product.name ?? '', unit: variants.find((v) => v.id === r.variantId)?.product.baseUnit ?? '',
      }));
    });
  }

  voidDelivery(id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const d = await tx.farmDelivery.findUnique({ where: { id } });
      if (!d) throw new NotFoundException('Delivery not found');
      if (d.voidedAt) throw new BadRequestException('Already voided');
      if (d.stockBranchId) await this.inventory.recordInTx(tx, { branchId: d.stockBranchId, variantId: d.variantId, type: InventoryTxnType.RETURN, quantityDelta: n(d.quantity), referenceId: d.id });
      const after = await tx.farmDelivery.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.delivery_voided', entityType: 'FarmDelivery', entityId: id, before: d, after });
      return after;
    });
  }

  recordPayment(dto: BuyerPaymentDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      if ((dto.method === 'MPESA' || dto.method === 'BANK' || dto.method === 'CHEQUE') && !dto.reference?.trim()) throw new BadRequestException('Enter the M-Pesa code, bank reference or cheque number');
      const buyer = await tx.farmBuyer.findUnique({ where: { id: dto.buyerId } });
      if (!buyer) throw new BadRequestException('That buyer was not found');
      const p = await tx.farmBuyerPayment.create({
        data: { organizationId, buyerId: buyer.id, date: asDate(dto.date), amount: dto.amount, method: dto.method, reference: dto.reference?.trim() || null, notes: dto.notes?.trim() || null, createdBy: orgUserId },
      });
      await this.audit.logInTx(tx, { action: 'farm.buyer_payment_recorded', entityType: 'FarmBuyerPayment', entityId: p.id, after: p });
      const left = aging((await this.entries(tx, [buyer.id])).get(buyer.id) ?? [], todayKey());
      return { ...p, amount: dto.amount, owed: left.owed, credit: left.credit };
    });
  }

  voidPayment(id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await tx.farmBuyerPayment.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Payment not found');
      if (p.voidedAt) throw new BadRequestException('Already voided');
      const after = await tx.farmBuyerPayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.buyer_payment_voided', entityType: 'FarmBuyerPayment', entityId: id, before: p, after });
      return after;
    });
  }

  // ── Enterprise tags and the sales report ────────────────────────────────

  listTags() {
    return this.tenantPrisma.run(async (tx) => tx.farmProductTag.findMany());
  }

  saveTags(dto: ProductTagsDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      for (const t of dto.tags) {
        if (!t.enterpriseId) {
          await tx.farmProductTag.deleteMany({ where: { variantId: t.variantId } });
          continue;
        }
        if (!(await tx.farmEnterprise.findUnique({ where: { id: t.enterpriseId } }))) throw new BadRequestException('Enterprise not found');
        await tx.farmProductTag.upsert({ where: { organizationId_variantId: { organizationId, variantId: t.variantId } }, create: { organizationId, variantId: t.variantId, enterpriseId: t.enterpriseId }, update: { enterpriseId: t.enterpriseId } });
      }
      await this.audit.logInTx(tx, { action: 'farm.product_tags_saved', entityType: 'FarmProductTag', entityId: organizationId, after: dto.tags });
      return tx.farmProductTag.findMany();
    });
  }

  /** Sales per enterprise between two days: till sales of tagged products plus credit deliveries. */
  report(from: string, to: string) {
    return this.tenantPrisma.run(async (tx) => {
      const start = new Date(Date.parse(`${from}T00:00:00Z`) - 3 * 3600_000);
      const end = new Date(Date.parse(`${addDays(to, 1)}T00:00:00Z`) - 3 * 3600_000);
      const [lines, deliveries, tags, enterprises] = await Promise.all([
        tx.saleLineItem.findMany({ where: { sale: { status: 'COMPLETED', createdAt: { gte: start, lt: end } } }, select: { variantId: true, quantity: true, unitPrice: true } }),
        tx.farmDelivery.findMany({ where: { voidedAt: null, date: { gte: asDate(from), lte: asDate(to) } } }),
        tx.farmProductTag.findMany(),
        tx.farmEnterprise.findMany({ select: { id: true, name: true } }),
      ]);
      const tagOf = new Map(tags.map((t) => [t.variantId, t.enterpriseId]));
      const rows = new Map<string, { enterpriseId: string | null; name: string; till: number; credit: number }>();
      const row = (eid: string | null) => {
        const key = eid ?? 'none';
        if (!rows.has(key)) rows.set(key, { enterpriseId: eid, name: eid ? enterprises.find((e) => e.id === eid)?.name ?? '' : 'Not tagged', till: 0, credit: 0 });
        return rows.get(key)!;
      };
      for (const l of lines) row(tagOf.get(l.variantId) ?? null).till += n(l.quantity) * n(l.unitPrice);
      for (const d of deliveries) row(d.enterpriseId ?? tagOf.get(d.variantId) ?? null).credit += n(d.amount);
      const list = [...rows.values()].map((r) => ({ ...r, till: r2(r.till), credit: r2(r.credit), total: r2(r.till + r.credit) })).sort((a, b) => b.total - a.total);
      return { from, to, rows: list, total: r2(list.reduce((s, r) => s + r.total, 0)) };
    });
  }

  // ── The till rule ───────────────────────────────────────────────────────

  private async isFarm(organizationId: string): Promise<boolean> {
    const hit = FarmSalesService.farmType.get(organizationId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.farm;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { industryType: true } });
    const farm = org?.industryType === 'FARM';
    FarmSalesService.farmType.set(organizationId, { farm, at: Date.now() });
    return farm;
  }

  /**
   * inventory.beforeDecrement for farms: milk and eggs may not be sold (at the till, online or on credit) beyond what is in stock,
   * because milk and eggs from treated animals are withheld and never put in stock. Other businesses return at once (cached).
   */
  async beforeDecrement(payload: unknown): Promise<void> {
    const p = payload as { branchId: string; variantId: string; quantityDelta: number; type: string };
    if (!SELLING.has(p.type)) return;
    let organizationId: string;
    try {
      organizationId = getTenantStore().organizationId;
    } catch {
      return;
    }
    if (!(await this.isFarm(organizationId))) return;
    await this.tenantPrisma.run(async (tx) => {
      const s = await tx.farmProduceSettings.findFirst({ select: { milkVariantId: true, eggVariantId: true } });
      if (!s || (p.variantId !== s.milkVariantId && p.variantId !== s.eggVariantId)) return;
      const item = await tx.inventoryItem.findUnique({ where: { branchId_variantId: { branchId: p.branchId, variantId: p.variantId } } });
      const onHand = n(item?.quantity);
      const short = tillShortfall(onHand, Math.abs(p.quantityDelta));
      if (!short) return;
      const v = await tx.productVariant.findUnique({ where: { id: p.variantId }, include: { product: { select: { name: true, baseUnit: true } } } });
      const what = p.variantId === s.milkVariantId ? 'Milk from treated cows is withheld and never goes into stock' : 'Eggs from treated birds are withheld and never go into stock';
      this.logger.warn(`Refused selling ${Math.abs(p.quantityDelta)} of farm produce ${p.variantId} with ${onHand} in stock`);
      throw new BadRequestException(`Only ${Math.max(0, onHand)} ${v?.product.baseUnit ?? ''} of ${v?.product.name ?? 'this produce'} are fit for sale. ${what}, so it cannot be sold. Record the milking or eggs first if some are missing.`);
    });
  }
}
