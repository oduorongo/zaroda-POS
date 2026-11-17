import type { Metadata } from "next";
import OrderDetail from "../../../components/order-detail";

// robots noindex, and no referrer: a guest's private link key is in this page's address.
export const metadata: Metadata = { title: "Order", robots: { index: false }, referrer: "no-referrer" };

export default function OrderPage({ params, searchParams }: { params: { id: string }; searchParams: { k?: string } }) {
  return <OrderDetail orderId={params.id} guestKey={typeof searchParams.k === "string" ? searchParams.k : undefined} />;
}
