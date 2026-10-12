import { DeliveryJobStatus, DeliveryQuoteStatus } from '@prisma/client';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';

/**
 * Called from OnlineOrdersService (inside its own transaction) so an order and its delivery
 * never disagree. Plain functions, not a service, so the order code needs no dependency on the
 * delivery module.
 */

const rejectOfferedQuotes = (tx: TenantTx, orderId: string) =>
  tx.deliveryQuote.updateMany({ where: { job: { orderId }, status: DeliveryQuoteStatus.OFFERED }, data: { status: DeliveryQuoteStatus.REJECTED } });

/**
 * The shop marked the order complete by hand (the rider's code didn't work, say): a delivery still
 * in progress is closed as delivered, and a request still waiting for quotes is withdrawn.
 */
export async function settleJobsOnManualComplete(tx: TenantTx, orderId: string): Promise<void> {
  await tx.deliveryJob.updateMany({
    where: { orderId, status: { in: [DeliveryJobStatus.ASSIGNED, DeliveryJobStatus.PICKED_UP] } },
    data: { status: DeliveryJobStatus.DELIVERED, deliveredAt: new Date() },
  });
  await tx.deliveryJob.updateMany({
    where: { orderId, status: DeliveryJobStatus.OPEN },
    data: { status: DeliveryJobStatus.CANCELLED, cancelledAt: new Date(), cancelReason: 'Order completed' },
  });
  await rejectOfferedQuotes(tx, orderId);
}

/** The shop cancelled the order: any delivery in play is cancelled with it. */
export async function cancelJobsOnOrderCancel(tx: TenantTx, orderId: string, reason: string): Promise<void> {
  await tx.deliveryJob.updateMany({
    where: { orderId, status: { in: [DeliveryJobStatus.OPEN, DeliveryJobStatus.ASSIGNED, DeliveryJobStatus.PICKED_UP] } },
    data: { status: DeliveryJobStatus.CANCELLED, cancelledAt: new Date(), cancelReason: `Order cancelled: ${reason}` },
  });
  await rejectOfferedQuotes(tx, orderId);
}
