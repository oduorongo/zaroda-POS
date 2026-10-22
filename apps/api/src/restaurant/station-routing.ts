import { BadRequestException, ConflictException } from '@nestjs/common';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';

/**
 * A station for each line of an order at a branch: the one the cashier chose, else the dish's own (Tables & Kitchen setup),
 * else the branch's first station. Archived stations are never used.
 */
export async function resolveLineStations(
  tx: TenantTx,
  branchId: string,
  lines: { variantId: string; stationId?: string }[],
): Promise<string[]> {
  const stations = await tx.kitchenStation.findMany({
    where: { branchId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (stations.length === 0)
    throw new ConflictException(
      'This branch has no kitchen station set up yet. Add one under Tables & Kitchen first.',
    );
  const ids = new Set(stations.map((s) => s.id));
  const dishes = await tx.restaurantDish.findMany({
    where: { variantId: { in: lines.map((l) => l.variantId) } },
  });
  const dishStation = new Map(dishes.map((d) => [d.variantId, d.stationId]));
  return lines.map((l) => {
    if (l.stationId) {
      if (!ids.has(l.stationId))
        throw new BadRequestException(
          'That kitchen station is not at this branch',
        );
      return l.stationId;
    }
    const own = dishStation.get(l.variantId);
    return own && ids.has(own) ? own : stations[0].id;
  });
}
