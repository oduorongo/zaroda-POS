import { ConflictException } from '@nestjs/common';
import {
  FulfilmentType,
  KitchenTicketStatus,
  OnlineOrder,
  OnlineOrderLine,
  OnlineOrderStatus,
  RestaurantTableStatus,
} from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { roundMoney } from './online-orders.util';

type OrderWithLines = OnlineOrder & { lines: OnlineOrderLine[] };

/** Stations a branch has, oldest first. The first one takes any dish that has no station of its own. */
export async function stationsFor(tx: TenantTx, branchId: string) {
  return tx.kitchenStation.findMany({ where: { branchId }, orderBy: { createdAt: 'asc' } });
}

/**
 * Sends a paid table order to the kitchen: one ticket per station (a dish goes to the station chosen for it under
 * Tables & Kitchen, or the branch's first station), all fired at once, linked to the order's sale. Then the table is
 * marked Occupied. The order is refused up front if the branch has no stations (see createTableOrder), so a paid
 * order can never be left with nowhere to go.
 */
export async function sendTableOrderToKitchen(tx: TenantTx, order: OrderWithLines, saleId: string): Promise<void> {
  if (!order.tableId) return;
  const stations = await stationsFor(tx, order.branchId);
  if (stations.length === 0) throw new ConflictException('This branch has no kitchen station set up, so the order cannot reach the kitchen');
  const stationIds = new Set(stations.map((s) => s.id));
  const dishes = await tx.restaurantDish.findMany({ where: { variantId: { in: order.lines.map((l) => l.variantId) } } });
  const stationOf = new Map(dishes.filter((d) => stationIds.has(d.stationId)).map((d) => [d.variantId, d.stationId]));

  const byStation = new Map<string, OnlineOrderLine[]>();
  for (const line of order.lines) {
    const stationId = stationOf.get(line.variantId) ?? stations[0].id;
    byStation.set(stationId, [...(byStation.get(stationId) ?? []), line]);
  }

  const now = new Date();
  for (const [stationId, lines] of byStation) {
    await tx.kitchenTicket.create({
      data: {
        saleId,
        stationId,
        courseNumber: 1,
        status: KitchenTicketStatus.QUEUED,
        firedAt: now,
        lines: {
          create: lines.map((l) => ({
            variantId: l.variantId,
            // A kitchen ticket is a "make N of these" instruction, so it is a whole number (see KitchenTicketLine).
            quantity: Math.max(1, Math.round(Number(l.quantity))),
            // The dish's own request first ("no onions"), then anything said about the whole order.
            notes: [l.note, order.buyerNote].filter((n): n is string => Boolean(n)).join(' - ') || undefined,
          })),
        },
      },
    });
  }

  await tx.restaurantTable.updateMany({
    where: { id: order.tableId, status: { not: RestaurantTableStatus.OCCUPIED } },
    data: { status: RestaurantTableStatus.OCCUPIED },
  });
}

/**
 * When the kitchen serves the last ticket of a table order, the order is complete: that is the moment commission
 * becomes owed (exactly as when a shop completes a pickup order by hand). Safe to call after every ticket.
 */
export async function completeTableOrderIfServed(tx: TenantTx, saleId: string): Promise<void> {
  const unserved = await tx.kitchenTicket.count({ where: { saleId, status: { not: KitchenTicketStatus.SERVED } } });
  if (unserved > 0) return;
  const order = await tx.onlineOrder.findFirst({
    where: { saleId, fulfilmentType: FulfilmentType.DINE_IN, status: { in: [OnlineOrderStatus.ACCEPTED, OnlineOrderStatus.READY] } },
  });
  if (!order) return;
  const now = new Date();
  await tx.onlineOrder.updateMany({
    where: { id: order.id, status: { in: [OnlineOrderStatus.ACCEPTED, OnlineOrderStatus.READY] } },
    data: {
      status: OnlineOrderStatus.COMPLETED,
      readyAt: order.readyAt ?? now,
      completedAt: now,
      commissionAmount: roundMoney(Number(order.subtotal) * Number(order.commissionRate)),
    },
  });
}

/** How far the kitchen has got, in words a diner can follow. */
export function kitchenProgress(tickets: { status: KitchenTicketStatus }[]) {
  const count = (s: KitchenTicketStatus) => tickets.filter((t) => t.status === s).length;
  const total = tickets.length;
  const served = count(KitchenTicketStatus.SERVED);
  const ready = count(KitchenTicketStatus.READY);
  const inProgress = count(KitchenTicketStatus.IN_PROGRESS);
  const stage =
    total === 0 ? 'WAITING' : served === total ? 'SERVED' : served + ready === total ? 'READY' : inProgress + ready + served > 0 ? 'PREPARING' : 'SENT';
  return { stage, total, served, ready, inProgress };
}
