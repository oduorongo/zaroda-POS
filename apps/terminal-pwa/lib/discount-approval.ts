import { apiPost, ApiError, OfflineError } from "./api";
import type { OutboxDiscount } from "./db";

/**
 * Gets a supervisor's approval for a discount while online: their PIN, unless they are the one signed in.
 * Returns the discount to put on the sale (with the approval's id), or throws a message to show.
 */
export async function approveDiscount(
  session: { orgUserId: string; accessToken: string },
  discount: { type: "PERCENT" | "FIXED"; value: number; approvedById: string },
  approverPin: string,
): Promise<OutboxDiscount> {
  if (discount.approvedById === session.orgUserId) return discount;
  try {
    const { approvalId } = await apiPost<{ approvalId: string }>(
      "/sales/discount-approvals",
      { ...discount, approverPin },
      session.accessToken,
    );
    return { ...discount, approvalId };
  } catch (err) {
    if (err instanceof OfflineError) throw new Error("Discounts need a connection - the supervisor's PIN is checked online.");
    throw new Error(err instanceof ApiError ? err.message : "Could not approve the discount.");
  }
}
