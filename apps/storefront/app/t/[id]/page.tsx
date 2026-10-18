import type { Metadata } from "next";
import { Suspense } from "react";
import TableOrderStatus from "../../../components/table-order-status";

// A diner's own order page: private to whoever holds the link, and never worth indexing.
export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default function TableOrderPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-secondary-500">Loading your order...</p>}>
      <TableOrderStatus orderId={params.id} />
    </Suspense>
  );
}
