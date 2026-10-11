import type { Metadata } from "next";
import OrdersView from "../../components/orders-view";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

export default function OrdersPage() {
  return <OrdersView />;
}
