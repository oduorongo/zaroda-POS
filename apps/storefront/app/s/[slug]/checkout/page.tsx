import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CheckoutView from "../../../../components/checkout-view";
import { ApiError, getShop } from "../../../../lib/api";

// Checkout reads the cart from the buyer's own device, so there's nothing
// worth indexing here.
export const metadata: Metadata = { title: "Review and pay", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: { slug: string } }) {
  try {
    const shop = await getShop(params.slug);
    return <CheckoutView shop={shop} />;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
