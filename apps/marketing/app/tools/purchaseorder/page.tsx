import type { Metadata } from "next";
import PurchaseOrderClient from "./purchaseorder-client";

export const metadata: Metadata = {
  title: "Purchase Order Generator — Free Tools — Zaroda POS",
  description: "Create a supplier purchase order in KES with itemized quantities and prices, then export it as a PDF.",
  alternates: { canonical: "https://zarodashop.com/tools/purchaseorder" },
};

export default function PurchaseOrderToolPage() {
  return <PurchaseOrderClient />;
}
