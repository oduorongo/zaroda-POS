import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InventoryTxnType, Prisma, QuantityMode, Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore, tenantContext } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { MAX_STOCK_ROWS, planStockUpdate, StockRowInput } from './stock-sync.util';

const KEY = /^zsync_([0-9a-f]{12})_[A-Za-z0-9_-]{32}$/;
export const hashSyncKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Keeps ZARODA's stock and prices in step with a shop's other POS: from a spreadsheet the owner uploads, or automatically
 * from the other system with a sync key. Each stock change is a STOCKTAKE movement (a count), never a silent overwrite.
 * dryRun only checks; the real run writes everything in one transaction, or nothing.
 */
@Injectable()
export class StockSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
  ) {}

  /** From the back office (a signed-in owner or manager). */
  update(input: { branchId: string; rows: StockRowInput[]; dryRun?: boolean }) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.runLong(organizationId, (tx) => this.apply(tx, organizationId, input, orgUserId, 'spreadsheet'));
  }

  // A long list can mean thousands of stock movements: more time than an ordinary request's transaction.
  private runLong<T>(organizationId: string, fn: (tx: TenantTx) => Promise<T>) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
        return fn(tx);
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }

  /** From the shop's other system, with its sync key (no ZARODA sign-in). */
  async updateWithKey(rawKey: string | undefined, input: { rows: StockRowInput[]; dryRun?: boolean }) {
    const key = await this.checkKey(rawKey);
    // Acts as the business itself (low-stock alerts need it); written down as the sync key, not a person.
    const store = { organizationId: key.organizationId, orgUserId: `system:sync-key:${key.id}`, role: Role.OWNER };
    return tenantContext.run(store, () =>
      this.runLong(key.organizationId, async (tx) => {
        await tx.stockSyncKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), requests: { increment: 1 } } });
        return this.apply(tx, key.organizationId, { branchId: key.branchId, rows: input.rows, dryRun: input.dryRun === true }, null, `sync key "${key.name}"`);
      }),
    );
  }

  private async checkKey(raw: string | undefined) {
    const m = raw ? KEY.exec(raw.trim()) : null;
    if (!m) throw new UnauthorizedException('Send your sync key as "Authorization: Bearer zsync_..."');
    const key = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_sync_key_prefix', ${m[1]}, true)`;
      return tx.stockSyncKey.findUnique({ where: { prefix: m[1] } });
    });
    const ok = key && !key.revokedAt && timingSafeEqual(Buffer.from(key.keyHash), Buffer.from(hashSyncKey(raw!.trim())));
    if (!key || !ok) throw new UnauthorizedException('This sync key is not valid or was switched off');
    return key;
  }

  private async apply(tx: TenantTx, organizationId: string, input: { branchId: string; rows: StockRowInput[]; dryRun?: boolean }, actorId: string | null, source: string) {
    if (!Array.isArray(input.rows) || input.rows.length === 0) throw new BadRequestException('The list has no rows');
    if (input.rows.length > MAX_STOCK_ROWS) throw new BadRequestException(`At most ${MAX_STOCK_ROWS} rows at a time`);
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch) throw new NotFoundException('Branch not found');

    const variants = await tx.productVariant.findMany({ select: { id: true, sku: true, barcode: true, price: true, quantityMode: true, name: true, product: { select: { name: true } } } });
    const { planned, problems } = planStockUpdate(
      input.rows,
      variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price: Number(v.price),
        quantityMode: v.quantityMode === QuantityMode.WEIGHT ? 'WEIGHT' : 'COUNT',
        name: v.name ? `${v.product.name} (${v.name})` : v.product.name,
      })),
    );
    const items = await tx.inventoryItem.findMany({ where: { branchId: branch.id, variantId: { in: planned.map((p) => p.variantId) } } });
    const onHand = new Map(items.map((i) => [i.variantId, Number(i.quantity)]));
    const prices = new Map(variants.map((v) => [v.id, Number(v.price)]));
    const lines = planned.map((p) => {
      const stockBefore = onHand.get(p.variantId) ?? 0;
      const priceBefore = prices.get(p.variantId) ?? 0;
      return {
        ...p,
        stockBefore,
        priceBefore,
        stockChange: p.stock === null ? 0 : Math.round((p.stock - stockBefore) * 1000) / 1000,
        priceChanged: p.price !== null && p.price !== priceBefore,
      };
    });
    const changed = lines.filter((l) => l.stockChange !== 0 || l.priceChanged);
    const summary = { rows: planned.length, stockChanges: changed.filter((l) => l.stockChange !== 0).length, priceChanges: changed.filter((l) => l.priceChanged).length };
    if (input.dryRun !== false || problems.length > 0) return { applied: false, ...summary, problems, lines };

    const reference = `stock-sync:${Date.now()}`;
    for (const l of changed) {
      if (l.stockChange !== 0) {
        await this.inventory.recordInTx(tx, { branchId: branch.id, variantId: l.variantId, type: InventoryTxnType.STOCKTAKE, quantityDelta: l.stockChange, referenceId: reference });
      }
      if (l.priceChanged) await tx.productVariant.update({ where: { id: l.variantId }, data: { price: new Prisma.Decimal(l.price!) } });
    }
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'stock_sync.applied',
        entityType: 'Branch',
        entityId: branch.id,
        after: { source, reference, ...summary, prices: changed.filter((l) => l.priceChanged).map((l) => ({ variantId: l.variantId, from: l.priceBefore, to: l.price })) },
      },
    });
    return { applied: true, ...summary, problems, lines };
  }

  // ── Sync keys (owner only) ───────────────────────────────────────────

  listKeys() {
    return this.tenantPrisma.run((tx) =>
      tx.stockSyncKey.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, prefix: true, branchId: true, lastUsedAt: true, requests: true, revokedAt: true, createdAt: true },
      }),
    );
  }

  /** The key is shown once, here; only its hash is kept. */
  createKey(input: { name: string; branchId: string }) {
    const { organizationId, orgUserId } = getTenantStore();
    const prefix = randomBytes(6).toString('hex');
    const key = `zsync_${prefix}_${randomBytes(24).toString('base64url')}`;
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.branch.findUnique({ where: { id: input.branchId } }))) throw new NotFoundException('Branch not found');
      const row = await tx.stockSyncKey.create({ data: { organizationId, branchId: input.branchId, name: input.name.trim(), prefix, keyHash: hashSyncKey(key), createdBy: orgUserId } });
      await tx.auditLog.create({ data: { organizationId, actorId: orgUserId, action: 'stock_sync_key.created', entityType: 'StockSyncKey', entityId: row.id, after: { name: row.name, prefix } } });
      return { id: row.id, name: row.name, prefix, key };
    });
  }

  revokeKey(id: string) {
    const { organizationId, orgUserId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const row = await tx.stockSyncKey.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Sync key not found');
      if (row.revokedAt) return { id, revokedAt: row.revokedAt };
      const updated = await tx.stockSyncKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { organizationId, actorId: orgUserId, action: 'stock_sync_key.revoked', entityType: 'StockSyncKey', entityId: id } });
      return { id, revokedAt: updated.revokedAt };
    });
  }
}
