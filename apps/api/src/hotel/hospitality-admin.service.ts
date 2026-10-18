import { Injectable } from '@nestjs/common';
import { FulfilmentType, OnlineOrderStatus, Prisma, RoomBookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { roundMoney } from '../online-orders/online-orders.util';
import { percent, watchReason } from './hotel-watch.util';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };
const PER_BUSINESS_CAP = 5000;
const DAY_MS = 86_400_000;
const sum = (items: number[]) => roundMoney(items.reduce((a, b) => a + b, 0));

/**
 * The platform owner's read-only view of the restaurant and hotel side: how each hotel's bookings are going (with a flag
 * for ones whose paid bookings too often end as no-shows or cancellations), and how table orders are going (with the
 * paid-but-stuck ones that need a person). Each business is read inside its own tenant context, like every other
 * cross-business list here.
 */
@Injectable()
export class HospitalityAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  async hotels(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);
    const organizations = await this.prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const hotels = [];
    const recent: {
      id: string;
      organizationId: string;
      organizationName: string;
      bookingNumber: string;
      status: RoomBookingStatus;
      guestName: string;
      guestPhone: string;
      roomTypeName: string;
      checkIn: string;
      checkOut: string;
      total: number;
      depositAmount: number;
      paid: boolean;
      note: string | null;
      createdAt: Date;
    }[] = [];

    for (const org of organizations) {
      const bookings = await this.runAsTenant(org.id, (tx) =>
        tx.roomBooking.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: PER_BUSINESS_CAP }),
      );
      if (bookings.length === 0) continue;

      const paid = bookings.filter((b) => b.paidAt !== null);
      const noShow = paid.filter((b) => b.status === RoomBookingStatus.NO_SHOW).length;
      const cancelled = paid.filter((b) => b.status === RoomBookingStatus.CANCELLED).length;
      const finished = bookings.filter((b) => b.status === RoomBookingStatus.CHECKED_OUT);
      const byStatus: Record<string, number> = {};
      for (const b of bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

      hotels.push({
        organizationId: org.id,
        organizationName: org.name,
        bookings: bookings.length,
        paidBookings: paid.length,
        byStatus,
        noShow,
        cancelled,
        noShowRate: percent(noShow, paid.length),
        cancelledRate: percent(cancelled, paid.length),
        depositsReceived: sum(paid.map((b) => b.depositAmount)),
        // Deposits of cancelled bookings sit in the hotel's own account and are owed back to the guest.
        depositsToRefund: sum(paid.filter((b) => b.status === RoomBookingStatus.CANCELLED).map((b) => b.depositAmount)),
        stayValue: sum(finished.map((b) => Number(b.total))),
        commissionRecorded: sum(finished.map((b) => Number(b.commissionAmount ?? 0))),
        // A deposit that arrived late (rooms already taken) or did not match is left as a note on the booking.
        flaggedPayments: bookings.filter((b) => b.lastPaymentError !== null && (b.status === RoomBookingStatus.CONFIRMED || b.status === RoomBookingStatus.PENDING_PAYMENT)).length,
        watch: watchReason({ paid: paid.length, noShow, cancelled }),
      });

      for (const b of bookings.slice(0, 40)) {
        recent.push({
          id: b.id,
          organizationId: org.id,
          organizationName: org.name,
          bookingNumber: b.bookingNumber,
          status: b.status === RoomBookingStatus.PENDING_PAYMENT && b.paymentDeadline <= new Date() ? RoomBookingStatus.EXPIRED : b.status,
          guestName: b.guestName,
          guestPhone: b.guestPhone,
          roomTypeName: b.roomTypeName,
          checkIn: b.checkIn.toISOString().slice(0, 10),
          checkOut: b.checkOut.toISOString().slice(0, 10),
          total: Number(b.total),
          depositAmount: b.depositAmount,
          paid: b.paidAt !== null,
          note: b.lastPaymentError ?? b.cancelReason,
          createdAt: b.createdAt,
        });
      }
    }

    hotels.sort((a, b) => Number(Boolean(b.watch)) - Number(Boolean(a.watch)) || b.bookings - a.bookings);
    recent.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      days,
      summary: {
        hotels: hotels.length,
        bookings: hotels.reduce((n, h) => n + h.bookings, 0),
        depositsReceived: sum(hotels.map((h) => h.depositsReceived)),
        commissionRecorded: sum(hotels.map((h) => h.commissionRecorded)),
        onWatch: hotels.filter((h) => h.watch).length,
        flaggedPayments: hotels.reduce((n, h) => n + h.flaggedPayments, 0),
      },
      hotels,
      recent: recent.slice(0, 60),
    };
  }

  async tableOrders(days: number) {
    const since = new Date(Date.now() - days * DAY_MS);
    const organizations = await this.prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const restaurants = [];
    const attention: {
      id: string;
      organizationId: string;
      organizationName: string;
      orderNumber: string;
      tableLabel: string | null;
      status: OnlineOrderStatus;
      amountDue: number;
      paidAt: Date | null;
      problem: string;
    }[] = [];

    for (const org of organizations) {
      const orders = await this.runAsTenant(org.id, (tx) =>
        tx.onlineOrder.findMany({
          where: { fulfilmentType: FulfilmentType.DINE_IN, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: PER_BUSINESS_CAP,
        }),
      );
      if (orders.length === 0) continue;

      const paid = orders.filter((o) => o.paidAt !== null);
      const completed = orders.filter((o) => o.status === OnlineOrderStatus.COMPLETED);
      const cancelledPaid = paid.filter((o) => o.status === OnlineOrderStatus.CANCELLED);
      // PAID means the diner paid but the order never reached the kitchen by itself: a person has to accept it.
      const stuck = orders.filter((o) => o.status === OnlineOrderStatus.PAID);
      const flagged = orders.filter((o) => o.lastPaymentError !== null && o.status === OnlineOrderStatus.PENDING_PAYMENT && /match/i.test(o.lastPaymentError));

      restaurants.push({
        organizationId: org.id,
        organizationName: org.name,
        orders: orders.length,
        paidOrders: paid.length,
        completedOrders: completed.length,
        sales: sum(paid.filter((o) => o.status !== OnlineOrderStatus.CANCELLED).map((o) => Number(o.subtotal))),
        refundsOwed: sum(cancelledPaid.map((o) => o.amountDue)),
        commissionRecorded: sum(completed.map((o) => Number(o.commissionAmount ?? 0))),
        notPaid: orders.filter((o) => o.status === OnlineOrderStatus.EXPIRED || (o.status === OnlineOrderStatus.PENDING_PAYMENT && o.paymentDeadline <= new Date())).length,
        stuck: stuck.length,
        flagged: flagged.length,
      });

      for (const o of stuck.slice(0, 15)) {
        attention.push({ id: o.id, organizationId: org.id, organizationName: org.name, orderNumber: o.orderNumber, tableLabel: o.tableLabel, status: o.status, amountDue: o.amountDue, paidAt: o.paidAt, problem: 'Paid but not sent to the kitchen - needs to be accepted by hand' });
      }
      for (const o of flagged.slice(0, 15)) {
        attention.push({ id: o.id, organizationId: org.id, organizationName: org.name, orderNumber: o.orderNumber, tableLabel: o.tableLabel, status: o.status, amountDue: o.amountDue, paidAt: o.paidAt, problem: o.lastPaymentError ?? 'Payment does not match the order' });
      }
    }

    restaurants.sort((a, b) => b.stuck + b.flagged - (a.stuck + a.flagged) || b.orders - a.orders);
    return {
      days,
      summary: {
        restaurants: restaurants.length,
        orders: restaurants.reduce((n, r) => n + r.orders, 0),
        sales: sum(restaurants.map((r) => r.sales)),
        commissionRecorded: sum(restaurants.map((r) => r.commissionRecorded)),
        needAttention: attention.length,
      },
      restaurants,
      attention,
    };
  }
}
