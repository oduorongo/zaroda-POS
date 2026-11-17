import type { Metadata } from "next";
import OrderDetail from "../../../components/order-detail";

// robots noindex, and no referrer: a guest's private link key is in this page's address.
export const metadata: Metadata = { title: "Order", robots: { index: false }, referrer: "no-referrer" };

export default async function OrderPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  return <OrderDetail orderId={params.id} guestKey={typeof searchParams.k === "string" ? searchParams.k : undefined} />;
}
