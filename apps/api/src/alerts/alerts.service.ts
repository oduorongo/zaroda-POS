import { Injectable } from '@nestjs/common';
import { CommissionInvoiceStatus, OnlineOrderStatus, Role, TableReservationStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { dayOf, FEE_KIND, nairobiHour, pauseDate } from '../online-store/commission.util';
import { feeOrderWhere } from '../online-store/fee-orders';

export interface StaffAlert {
  /** Stable for as long as the thing is waiting, so the app can ring once per new item and not on every refresh. */
  key: string;
  kind: 'ORDER' | 'RESERVATION' | 'FEES';
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
    const { role } = getTenantStore();
    const canPay = role === Role.OWNER || role === Role.MANAGER;
    const now = new Date();
    return this.tenantPrisma.run(async (tx) => {
      const [orders, reservations, unsentFees, unpaidFeeInvoices] = await Promise.all([
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
        // The shopper fees the shop has collected: what it holds today, and what it has been asked to send but has not.
        canPay ? tx.onlineOrder.aggregate({ where: feeOrderWhere(), _sum: { convenienceFee: true } }) : Promise.resolve(null),
        canPay ? tx.commissionInvoice.findMany({ where: { status: CommissionInvoiceStatus.ISSUED, kind: FEE_KIND }, orderBy: { issuedAt: 'desc' }, take: 5 }) : Promise.resolve([]),
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
      const today = dayOf(now);
      // Rings again each new day it stays unsent: the key carries today's date.
      for (const invoice of unpaidFeeInvoices) {
        const hiddenOn = pauseDate(invoice.dueDate, invoice.kind);
        const hidden = hiddenOn <= now;
        items.push({
          key: `fees:${invoice.id}:${today}`,
          kind: 'FEES',
          title: `Send KES ${invoice.amountDue.toLocaleString('en-KE')} to Zaroda`,
          body: hidden
            ? 'Shopper fees you collected. Your shop is hidden from buyers until you send them.'
            : `Shopper fees you collected on ${dayOf(invoice.issuedAt)}. Send them by ${dayOf(hiddenOn)} or your shop is hidden from buyers.`,
          href: '/settings/online-shop',
          createdAt: invoice.issuedAt,
        });
      }
      const holding = unsentFees?._sum.convenienceFee ?? 0;
      if (holding >= 1 && nairobiHour(now) >= 17) {
        items.push({
          key: `fees-today:${today}`,
          kind: 'FEES',
          title: `Today's shopper fees: KES ${holding.toLocaleString('en-KE')}`,
          body: 'You collected this with your customers\' payments. Send it to Zaroda before midnight.',
          href: '/settings/online-shop',
          createdAt: now,
        });
      }
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items };
    });
  }
}
