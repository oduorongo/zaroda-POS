import type { Metadata } from "next";
import InvoiceClient from "./invoice-client";

export const metadata: Metadata = {
  title: "Invoice Generator — Free Tools — Zaroda POS",
  description: "Create a line-item invoice in KES with tax and totals, then export it as a PDF — free, no sign-up.",
  alternates: { canonical: "https://zarodashop.com/tools/invoice" },
};

export default function InvoiceToolPage() {
  return <InvoiceClient />;
}
