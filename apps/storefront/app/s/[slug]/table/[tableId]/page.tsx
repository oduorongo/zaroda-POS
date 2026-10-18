import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TableMenu from "../../../../../components/table-menu";
import { ApiError, getShopFresh, getTable } from "../../../../../lib/api";

// The menu shows what the kitchen can make right now, so it is never served from a cache. Not for search engines either.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order at your table", robots: { index: false } };

export default async function TablePage({ params }: { params: { slug: string; tableId: string } }) {
  try {
    const [shop, table] = await Promise.all([getShopFresh(params.slug), getTable(params.slug, params.tableId)]);
    return <TableMenu shop={shop} table={table} />;
  } catch (err) {
    // An unknown table or a shop that is offline reads as "not found", never an error screen at someone's table.
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
}
