import { OnlineOrderStatus, Prisma } from '@prisma/client';

/** An order whose shopper has paid is one the shop has collected the convenience fee on (until it is cancelled or expires). */
export const FEE_ORDER_STATUSES = [OnlineOrderStatus.PAID, OnlineOrderStatus.ACCEPTED, OnlineOrderStatus.READY, OnlineOrderStatus.COMPLETED];

/**
 * Orders carrying a convenience fee the shop has collected and not yet sent to Zaroda. `before` limits it to orders paid
 * before that moment (used to catch up on earlier days without touching today's, which close at the end of the day).
 */
export function feeOrderWhere(before?: Date): Prisma.OnlineOrderWhereInput {
  return {
    convenienceFee: { gt: 0 },
    commissionInvoiceId: null,
    status: { in: FEE_ORDER_STATUSES },
    ...(before ? { paidAt: { lt: before } } : {}),
  };
}
