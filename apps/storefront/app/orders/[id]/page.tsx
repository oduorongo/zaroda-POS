import type { Metadata } from "next";
import OrderDetail from "../../../components/order-detail";

export const metadata: Metadata = { title: "Order", robots: { index: false } };

export default function OrderPage({ params }: { params: { id: string } }) {
  return <OrderDetail orderId={params.id} />;
}
