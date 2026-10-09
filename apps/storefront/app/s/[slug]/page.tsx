import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShopView from "../../../components/shop-view";
import { ApiError, getShop } from "../../../lib/api";
import type { Shop } from "../../../lib/types";

export const revalidate = 30;

async function loadShop(slug: string): Promise<Shop> {
  try {
    return await getShop(slug);
  } catch (err) {
    // A shop that's offline, unpaid or half set up is just "not found" to a buyer.
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const shop = await getShop(params.slug);
    const description = shop.description ?? `Order from ${shop.name} and pay with M-Pesa.`;
    return {
      title: shop.name,
      description,
      openGraph: { title: shop.name, description, images: shop.products.flatMap((p) => p.images).slice(0, 1) },
    };
  } catch {
    return { title: "Shop" };
  }
}

export default async function ShopPage({ params }: { params: { slug: string } }) {
  const shop = await loadShop(params.slug);
  return <ShopView shop={shop} />;
}
