import { Injectable, NotFoundException } from '@nestjs/common';
import { OnlineOrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { hasOverdueCommission } from '../online-store/commission.service';
import { paymentsReady } from '../online-store/payment-gateway';
import { availablePortions, loadRecipeMap, stockNeeds } from './dish-stock.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
const MAX_DIRECTORY_SHOPS = 60;

export interface LiveShop {
  organizationId: string;
  slug: string;
  displayName: string;
  description: string | null;
  contactPhone: string | null;
  fulfilmentBranchId: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  commissionRate: number | null;
  paymentGateway: string;
  /** ZARODA has taken this business's hotel rooms off the marketplace. */
  hotelBlocked: boolean;
  /** ZARODA has switched off ordering from table QR codes for this business. */
  tableOrderingBlocked: boolean;
  /** The restaurant takes table reservation requests from the marketplace. */
  reservationsEnabled: boolean;
}

/**
 * Reads a live shop's catalog for unauthenticated/buyer callers - the one
 * place that enters a tenant from a public slug. Inside one transaction:
 * opt in to the narrow public_catalog_read policy (rls.sql) to resolve the
 * slug, then set app.current_tenant to THAT shop's organization, so every
 * further query is ordinary tenant-scoped RLS - another business's data is
 * unreachable even if a query below were wrong.
 */
@Injectable()
export class ShopCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  runForShop<T>(slug: string, fn: (tx: TenantTx, shop: LiveShop) => Promise<T>, extra?: { buyerId?: string }): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_catalog', 'on', true)`;
      const store = await tx.onlineStore.findUnique({ where: { slug: slug.toLowerCase() } });
      // Policy already hides unpublished/unpaid shops; the field checks
      // here also cover a half-configured shop that slipped through.
      if (!store || !store.fulfilmentBranchId || !store.displayName || !paymentsReady(store)) {
        throw new NotFoundException('Shop not found');
      }
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${store.organizationId}, true)`;
      // A shop with commission unpaid past its grace period is closed to
      // buyers: same "not found" as an offline shop, so no new orders can be
      // placed. Orders already in progress are untouched (they don't come
      // through here).
      if (await hasOverdueCommission(tx)) throw new NotFoundException('Shop not found');
      if (extra?.buyerId) {
        await tx.$executeRaw`SELECT set_config('app.current_buyer', ${extra.buyerId}, true)`;
      }
      return fn(tx, {
        organizationId: store.organizationId,
        slug: store.slug!,
        displayName: store.displayName,
        description: store.description,
        contactPhone: store.contactPhone,
        fulfilmentBranchId: store.fulfilmentBranchId,
        pickupEnabled: store.pickupEnabled,
        deliveryEnabled: store.deliveryEnabled,
        commissionRate: store.commissionRate != null ? Number(store.commissionRate) : null,
        paymentGateway: store.paymentGateway,
        hotelBlocked: store.hotelBlockedAt !== null,
        tableOrderingBlocked: store.tableOrderingBlockedAt !== null,
        reservationsEnabled: store.reservationsEnabled,
      });
    }, TX_OPTIONS);
  }

  /**
   * Quantity that can still be sold online per variant at a branch. An ordinary item: stock on hand minus what open
   * online orders are holding (unpaid orders still inside their payment window, and paid orders not yet accepted -
   * accepting deducts the real stock, so accepted orders are already reflected in on-hand). A dish made from a recipe
   * has no stock of its own: it is as many portions as its scarcest INGREDIENT allows, after the ingredients that
   * open orders (for that dish or any other dish sharing them) are holding. So a dish drops off the menu the moment
   * an ingredient runs out, and nobody can order what the kitchen can no longer make.
   */
  async availableQuantities(tx: TenantTx, branchId: string, variantIds: string[]): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const heldLines = await tx.onlineOrderLine.findMany({
      where: {
        order: {
          branchId,
          OR: [
            { status: OnlineOrderStatus.PAID },
            { status: OnlineOrderStatus.PENDING_PAYMENT, paymentDeadline: { gt: new Date() } },
          ],
        },
      },
      select: { variantId: true, quantity: true },
    });
    const recipes = await loadRecipeMap(tx, [...variantIds, ...heldLines.map((l) => l.variantId)]);
    const held = stockNeeds(heldLines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity) })), recipes);

    // The things actually kept in stock behind what was asked for: a dish's ingredients, or the item itself.
    const stockIds = new Set<string>();
    for (const id of variantIds) {
      const recipe = recipes.get(id);
      if (recipe && recipe.length > 0) recipe.forEach((i) => stockIds.add(i.ingredientVariantId));
      else stockIds.add(id);
    }
    const items = await tx.inventoryItem.findMany({ where: { branchId, variantId: { in: [...stockIds] } } });
    const onHand = new Map(items.map((i) => [i.variantId, Number(i.quantity)]));
    return availablePortions(variantIds, recipes, onHand, held);
  }

  /**
   * Products a buyer can see: marked onlineVisible, with at least one variant. This includes restaurant dishes made
   * from a recipe - their availability comes from their ingredients (see availableQuantities).
   */
  sellableProducts(tx: TenantTx, productIds?: string[]) {
    return tx.product.findMany({
      where: {
        onlineVisible: true,
        ...(productIds ? { id: { in: productIds } } : {}),
        variants: { some: {} },      },
      include: {
        category: { select: { id: true, name: true } },
        variants: { orderBy: { price: 'asc' } },
        images: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The marketplace's shop directory: every live shop, optionally filtered
   * by a name/county search. Same opt-in as runForShop to read online_stores
   * (public_catalog_read: paid for AND published only), then, one shop at a
   * time, that shop's tenant context for its branch location and cover
   * photo - sequential on purpose, like PlatformAdminService's per-tenant
   * loops (concurrent interactive transactions exhaust the pool). Capped
   * at MAX_DIRECTORY_SHOPS; fine at this scale, revisit with a denormalized
   * listing table if the marketplace grows past it.
   */
  async listShops(search?: string) {
    const needle = search?.trim().toLowerCase() ?? '';
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_catalog', 'on', true)`;
      const stores = await tx.onlineStore.findMany({
        where: {
          slug: { not: null },
          displayName: { not: null },
          fulfilmentBranchId: { not: null },
          OR: [{ tumaApiKeyEncrypted: { not: null } }, { mpesaConsumerKeyEncrypted: { not: null } }],
        },
        orderBy: { displayName: 'asc' },
        take: MAX_DIRECTORY_SHOPS,
      });

      const shops = [];
      for (const store of stores) {
        if (!paymentsReady(store)) continue; // the gateway it chose must be fully set up
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${store.organizationId}, true)`;
        if (await hasOverdueCommission(tx)) continue;
        const [branch, products] = await Promise.all([
          tx.branch.findUnique({
            where: { id: store.fulfilmentBranchId! },
            select: { county: true, subCounty: true },
          }),
          this.sellableProducts(tx),
        ]);
        // A shop with nothing to buy isn't worth a card yet.
        if (products.length === 0) continue;
        const cover = products.flatMap((p) => p.images).at(0);
        shops.push({
          slug: store.slug!,
          name: store.displayName!,
          description: store.description,
          county: branch?.county ?? null,
          subCounty: branch?.subCounty ?? null,
          productCount: products.length,
          coverImage: cover ? this.storage.publicUrl(cover.storageKey) : null,
          pickupEnabled: store.pickupEnabled,
          deliveryEnabled: store.deliveryEnabled,
        });
      }
      if (!needle) return shops;
      return shops.filter((s) =>
        [s.name, s.description, s.county, s.subCounty].some((v) => v?.toLowerCase().includes(needle)),
      );
    }, { timeout: 30_000, maxWait: 15_000 });
  }

  /**
   * Runs `fn` once for every live shop, inside that shop's own tenant context, and collects what it returns (null =
   * leave this shop out). The same rules as the shop directory: payments fully set up, and not closed for unpaid commission.
   */
  async mapLiveShops<T>(
    fn: (
      tx: TenantTx,
      shop: { organizationId: string; slug: string; displayName: string; description: string | null; contactPhone: string | null; fulfilmentBranchId: string; hotelBlocked: boolean },
    ) => Promise<T | null>,
  ): Promise<T[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_catalog', 'on', true)`;
      const stores = await tx.onlineStore.findMany({
        where: {
          slug: { not: null },
          displayName: { not: null },
          fulfilmentBranchId: { not: null },
          OR: [{ tumaApiKeyEncrypted: { not: null } }, { mpesaConsumerKeyEncrypted: { not: null } }],
        },
        orderBy: { displayName: 'asc' },
        take: MAX_DIRECTORY_SHOPS,
      });
      const results: T[] = [];
      for (const store of stores) {
        if (!paymentsReady(store)) continue;
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${store.organizationId}, true)`;
        if (await hasOverdueCommission(tx)) continue;
        const result = await fn(tx, {
          organizationId: store.organizationId,
          slug: store.slug!,
          displayName: store.displayName!,
          description: store.description,
          contactPhone: store.contactPhone,
          fulfilmentBranchId: store.fulfilmentBranchId!,
          hotelBlocked: store.hotelBlockedAt !== null,
        });
        if (result !== null) results.push(result);
      }
      return results;
    }, { timeout: 30_000, maxWait: 15_000 });
  }

  async getShop(slug: string) {
    return this.runForShop(slug, async (tx, shop) => {
      const products = await this.sellableProducts(tx);
      const available = await this.availableQuantities(
        tx,
        shop.fulfilmentBranchId,
        products.flatMap((p) => p.variants.map((v) => v.id)),
      );
      const branch = await tx.branch.findUnique({
        where: { id: shop.fulfilmentBranchId },
        select: { name: true, county: true, subCounty: true },
      });
      return {
        slug: shop.slug,
        name: shop.displayName,
        description: shop.description,
        contactPhone: shop.contactPhone,
        pickupEnabled: shop.pickupEnabled,
        deliveryEnabled: shop.deliveryEnabled,
        location: branch ? { branchName: branch.name, county: branch.county, subCounty: branch.subCounty } : null,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.onlineDescription,
          category: p.category,
          images: p.images.map((i) => this.storage.publicUrl(i.storageKey)),
          variants: p.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            price: Number(v.price),
            quantityMode: v.quantityMode,
            available: available.get(v.id) ?? 0,
          })),
        })),
      };
    });
  }
}
