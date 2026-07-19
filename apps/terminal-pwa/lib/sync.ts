import { db, getActiveSession } from "./db";
import { apiPost, ApiError, OfflineError } from "./api";

interface SaleResponse {
  id: string;
}

/**
 * Drains the outbox in original creation order (DESIGN.md §6 - ordering
 * matters if a later entry ever depends on an earlier one, e.g. a void
 * queued right after the sale it voids). Each POST /sales call is
 * idempotent on clientId, so a sync that gets interrupted partway through
 * and retried later never double-sells anything - the server just returns
 * the already-created sale for any clientId it's seen before.
 *
 * Requires an active cashier session to authenticate the request, but the
 * session used to *sync* doesn't have to be the one that *rang up* the
 * sale - the payload's own cashierSessionId is what attributes the sale to
 * whoever actually sold it, preserved from when it was queued.
 */
export async function syncOutbox(): Promise<{ synced: number; failed: number; stillOffline: boolean }> {
  const session = await getActiveSession();
  if (!session) return { synced: 0, failed: 0, stillOffline: false };

  const pending = await db.outbox.where("status").anyOf(["pending", "failed"]).sortBy("createdAt");
  let synced = 0;
  let failed = 0;
  let stillOffline = false;

  for (const sale of pending) {
    await db.outbox.update(sale.clientId, { status: "syncing" });
    try {
      const result = await apiPost<SaleResponse>(
        "/sales",
        {
          clientId: sale.clientId,
          branchId: sale.branchId,
          terminalId: sale.terminalId,
          cashierSessionId: sale.cashierSessionId,
          lineItems: sale.lineItems.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          payments: [{ method: "CASH", amount: sale.paymentAmount }],
        },
        session.accessToken,
      );
      await db.outbox.update(sale.clientId, { status: "synced", serverSaleId: result.id, lastError: null });
      synced++;
    } catch (error) {
      if (error instanceof OfflineError) {
        // Connectivity dropped mid-sync - stop here, leave this and every
        // later entry as pending, try again on the next sync pass.
        await db.outbox.update(sale.clientId, { status: "pending" });
        stillOffline = true;
        break;
      }
      // A real rejection from the server (e.g. validation error) - surfaced
      // to the manager via the outbox status, not silently retried forever.
      const message = error instanceof ApiError ? error.message : "Unknown sync error";
      await db.outbox.update(sale.clientId, { status: "failed", lastError: message });
      failed++;
    }
  }

  return { synced, failed, stillOffline };
}

export async function pendingOutboxCount(): Promise<number> {
  return db.outbox.where("status").anyOf(["pending", "failed"]).count();
}
