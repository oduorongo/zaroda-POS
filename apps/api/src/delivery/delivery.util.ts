import { createHmac } from 'crypto';

/** How long riders have to quote, and the buyer to choose, after the shop asks for a rider. */
export const QUOTE_WINDOW_MS = 30 * 60_000;
/** Wrong delivery-code tries before the rider is locked out and the shop has to settle the delivery. */
export const MAX_CODE_ATTEMPTS = 5;
/** Sanity limits on a rider's price, in whole shillings. */
export const MIN_FEE = 20;
export const MAX_FEE = 10_000;
/** Cash a rider can report having collected - generous, since it can include the goods if the buyer paid cash for them too. */
export const MAX_CASH_COLLECTED = 1_000_000;

/**
 * The 4-digit code a buyer reads out to the rider at the door. Derived from the job id with a
 * server-only key instead of being stored: nothing in the database reveals it, the buyer's page
 * can always show it again, and a rider (who never sees it) has to be told it in person.
 */
export function deliveryCodeFor(jobId: string, key: Buffer): string {
  const digest = createHmac('sha256', key).update(`delivery-code:${jobId}`).digest();
  return (digest.readUInt32BE(0) % 10_000).toString().padStart(4, '0');
}

/**
 * What riders may see of the delivery address BEFORE being chosen: only the first part, so they
 * can judge the distance without every approved rider learning where a buyer lives. Buyers are
 * asked to put the area first ("Milimani, house 4 ..."). The full address goes only to the
 * rider who is chosen.
 */
export function summarizeDropoff(address: string | null | undefined): string {
  const firstLine = (address ?? '').split(/\r?\n/)[0] ?? '';
  const parts = firstLine
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const summary = parts.slice(0, 2).join(', ');
  if (!summary) return 'Delivery address given';
  return summary.length > 60 ? `${summary.slice(0, 57)}...` : summary;
}

export type JobStatusLike = 'OPEN' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';

/** A job still in play: it blocks a second job for the same order. */
export const isActiveJobStatus = (status: JobStatusLike) => status === 'OPEN' || status === 'ASSIGNED' || status === 'PICKED_UP';

/** An OPEN job past its deadline counts as expired, whether or not anything has recorded that yet. */
export const effectiveJobStatus = (job: { status: JobStatusLike; quoteDeadline: Date }, now = new Date()): JobStatusLike =>
  job.status === 'OPEN' && job.quoteDeadline <= now ? 'EXPIRED' : job.status;

/** Whether a rider of the given kind may quote on a job with the given audience. */
export function mayQuote(
  audience: 'SHOP_RIDERS' | 'EVERYONE' | 'ONE_RIDER',
  job: { organizationId: string; targetRiderId: string | null },
  rider: { id: string; organizationId: string | null; status: string },
): boolean {
  if (rider.status !== 'APPROVED') return false;
  switch (audience) {
    case 'EVERYONE':
      // The business's own riders and the shared pool - never another business's own riders.
      return rider.organizationId === null || rider.organizationId === job.organizationId;
    case 'SHOP_RIDERS':
      return rider.organizationId === job.organizationId;
    case 'ONE_RIDER':
      return job.targetRiderId === rider.id;
  }
}
