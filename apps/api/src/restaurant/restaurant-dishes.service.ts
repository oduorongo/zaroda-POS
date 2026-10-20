import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { variantTitle } from '../catalog/variant-title';

/**
 * Which kitchen station prepares each dish, for orders that come from a table QR code (nobody at the till is there to
 * pick a station per line). A dish with no choice goes to the branch's first station.
 */
@Injectable()
export class RestaurantDishesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async list() {
    const variants = await this.tenantPrisma.run((tx) =>
      tx.productVariant.findMany({
        include: {
          product: { select: { name: true, onlineVisible: true } },
          restaurantDish: { select: { stationId: true } },
          recipeIngredients: { select: { id: true } },
        },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
        take: 1000,
      }),
    );
    return variants.map((v) => ({
      variantId: v.id,
      name: variantTitle(v.product.name, v.name),
      sku: v.sku,
      price: Number(v.price),
      onlineVisible: v.product.onlineVisible,
      hasRecipe: v.recipeIngredients.length > 0,
      stationId: v.restaurantDish?.stationId ?? null,
    }));
  }

  /** Whether ZARODA has switched off ordering from table QR codes for this business, and why. */
  async orderingStatus() {
    const store = await this.tenantPrisma.run((tx) => tx.onlineStore.findFirst({ select: { tableOrderingBlockedAt: true, tableOrderingBlockedReason: true } }));
    return { blockedReason: store?.tableOrderingBlockedAt ? (store.tableOrderingBlockedReason ?? 'Switched off by Zaroda') : null };
  }

  /** stationId null = back to "the branch's first station". */
  async setStation(variantId: string, stationId: string | null) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw new NotFoundException('Dish not found');
      if (stationId === null) {
        await tx.restaurantDish.deleteMany({ where: { variantId } });
        return { variantId, stationId: null };
      }
      const station = await tx.kitchenStation.findUnique({ where: { id: stationId } });
      if (!station) throw new NotFoundException('Kitchen station not found');
      await tx.restaurantDish.upsert({
        where: { variantId },
        create: { organizationId, variantId, stationId },
        update: { stationId },
      });
      return { variantId, stationId };
    });
  }
}
