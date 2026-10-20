import { Injectable } from '@nestjs/common';
import { OnlineOrderStatus, TableReservationStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';

export interface StaffAlert {
  /** Stable for as long as the thing is waiting, so the app can ring once per new item and not on every refresh. */
  key: string;
  kind: 'ORDER' | 'RESERVATION';
  title: string;
  body: string;
  /** A page in the back office where it is dealt with. */
  href: string;
  createdAt: Date;
}

const MAX_PER_KIND = 20;
const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;

/**
 * What is waiting for the business right now: orders that have been paid and need accepting, and table requests that
 * need an answer. The apps ask every few seconds and ring when a key they have not seen shows up, so this only ever
 * reports what is STILL waiting - once someone deals with it, it drops off by itself.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async staff(): Promise<{ items: StaffAlert[] }> {
    return this.tenantPrisma.run(async (tx) => {
      const [orders, reservations] = await Promise.all([
        tx.onlineOrder.findMany({
          where: { status: OnlineOrderStatus.PAID },
          orderBy: { createdAt: 'desc' },
          take: MAX_PER_KIND,
          select: { id: true, orderNumber: true, fulfilmentType: true, buyerName: true, amountDue: true, createdAt: true },
        }),
        tx.tableReservation.findMany({
          where: { status: TableReservationStatus.REQUESTED },
          orderBy: { createdAt: 'desc' },
          take: MAX_PER_KIND,
          select: { id: true, guestName: true, partySize: true, date: true, time: true, createdAt: true },
        }),
      ]);

      const items: StaffAlert[] = [
        ...orders.map((o) => ({
          key: `order:${o.id}`,
          kind: 'ORDER' as const,
          title: `New ${o.fulfilmentType === 'DELIVERY' ? 'delivery' : o.fulfilmentType === 'DINE_IN' ? 'table' : 'pickup'} order ${o.orderNumber}`,
          body: `${o.buyerName ?? 'A customer'} - ${kes(o.amountDue)}. Paid and waiting for you to accept.`,
          href: '/online-orders',
          createdAt: o.createdAt,
        })),
        ...reservations.map((r) => ({
          key: `reservation:${r.id}`,
          kind: 'RESERVATION' as const,
          title: `Table request for ${r.partySize}`,
          body: `${r.guestName} - ${r.date.toISOString().slice(0, 10)} at ${r.time}. Waiting for your answer.`,
          href: '/restaurant',
          createdAt: r.createdAt,
        })),
      ];
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items };
    });
  }
}
