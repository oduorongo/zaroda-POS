import type { Order, OrderStatus } from "../lib/types";

const LABELS: Record<OrderStatus, { label: string; tone: string }> = {
  PENDING_PAYMENT: { label: "Waiting for payment", tone: "bg-warning-50 text-warning-700" },
  PAID: { label: "Paid - waiting for the shop", tone: "bg-primary-50 text-primary-700" },
  ACCEPTED: { label: "Being prepared", tone: "bg-primary-50 text-primary-700" },
  READY: { label: "Ready", tone: "bg-success-50 text-success-700" },
  COMPLETED: { label: "Completed", tone: "bg-success-50 text-success-700" },
  CANCELLED: { label: "Cancelled", tone: "bg-error-50 text-error-700" },
  EXPIRED: { label: "Expired", tone: "bg-secondary-500/10 text-secondary-700" },
};

/** READY means different things for the buyer depending on how they're getting it. */
export function statusLabel(order: Pick<Order, "status" | "fulfilmentType">): string {
  if (order.status === "READY") return order.fulfilmentType === "PICKUP" ? "Ready for pickup" : "On its way";
  if (order.status === "COMPLETED") return order.fulfilmentType === "PICKUP" ? "Collected" : "Delivered";
  return LABELS[order.status].label;
}

export default function OrderStatusBadge({ order }: { order: Pick<Order, "status" | "fulfilmentType"> }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${LABELS[order.status].tone}`}>{statusLabel(order)}</span>;
}

/** The happy path, for the progress strip on an order page. */
export const PROGRESS_STEPS: { status: OrderStatus; label: string }[] = [
  { status: "PAID", label: "Paid" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "READY", label: "Ready" },
  { status: "COMPLETED", label: "Done" },
];

const ORDER_INDEX: Record<OrderStatus, number> = {
  PENDING_PAYMENT: -1,
  PAID: 0,
  ACCEPTED: 1,
  READY: 2,
  COMPLETED: 3,
  CANCELLED: -1,
  EXPIRED: -1,
};

export const progressIndex = (status: OrderStatus) => ORDER_INDEX[status];
