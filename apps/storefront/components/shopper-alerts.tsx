"use client";

import Link from "next/link";
import { ActivityAlerts, type AlertItem } from "@zaroda/ui";
import { getOrderDelivery, listOrders } from "../lib/api";
import { kes } from "../lib/format";
import { useStore } from "./store-provider";

/**
 * Pop-up and ring for a signed-in shopper while the site is open: the shop accepted the order, it is ready, a rider has
 * named a price, or the rider has collected it. Only orders still in progress are looked at, so old orders never ring.
 */
export default function ShopperAlerts() {
  const { buyer, token } = useStore();
  if (!buyer || !token) return null;

  const fetchItems = async (): Promise<AlertItem[]> => {
    const orders = await listOrders(token);
    const active = orders.filter((o) => o.status === "PAID" || o.status === "ACCEPTED" || o.status === "READY");
    const items: AlertItem[] = [];

    for (const order of active) {
      if (order.status === "ACCEPTED") {
        items.push({ key: `accepted:${order.id}`, title: `${order.shop.name} accepted your order`, body: `Order ${order.orderNumber} is being prepared.`, href: `/orders/${order.id}` });
      } else if (order.status === "READY") {
        items.push({
          key: `ready:${order.id}`,
          title: order.fulfilmentType === "DELIVERY" ? `Your order ${order.orderNumber} is ready for the rider` : `Your order ${order.orderNumber} is ready`,
          body: order.fulfilmentType === "PICKUP" ? `Come and collect it from ${order.shop.name}.` : `${order.shop.name} has it packed.`,
          href: `/orders/${order.id}`,
        });
      }
    }

    // Delivery: a rider's price, then "on its way". Only the few orders that are out for delivery are asked about.
    const deliveries = active.filter((o) => o.fulfilmentType === "DELIVERY").slice(0, 5);
    const found = await Promise.all(deliveries.map((o) => getOrderDelivery(token, o.id).then((d) => ({ order: o, delivery: d })).catch(() => ({ order: o, delivery: null }))));
    for (const { order, delivery } of found) {
      if (!delivery) continue;
      if (delivery.status === "OPEN" && delivery.quotes.length > 0) {
        const latest = delivery.quotes[delivery.quotes.length - 1];
        items.push({
          key: `quote:${latest.id}`,
          title: "A rider offered a price",
          body: `${kes(latest.fee)} to deliver order ${order.orderNumber}. Choose a rider.`,
          href: `/orders/${order.id}`,
        });
      } else if (delivery.status === "PICKED_UP") {
        items.push({
          key: `pickedup:${delivery.id}`,
          title: `Your order ${order.orderNumber} is on its way`,
          body: "The rider has it. Keep your delivery code ready - give it only after you get your goods.",
          href: `/orders/${order.id}`,
        });
      }
    }
    return items;
  };

  return <ActivityAlerts key={buyer.id} storageKey={`zaroda-shopper-alerts:${buyer.id}`} LinkComponent={Link} fetchItems={fetchItems} />;
}
