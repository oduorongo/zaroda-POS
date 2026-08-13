import type { Metadata } from "next";
import MarginClient from "./margin-client";

export const metadata: Metadata = {
  title: "Profit Margin Calculator — Free Tools — Zaroda POS",
  description: "Free profit margin and markup calculator in KES — work out margin from cost and selling price, or reverse it to find a selling price.",
  alternates: { canonical: "https://zarodashop.com/tools/margin" },
};

export default function MarginToolPage() {
  return <MarginClient />;
}
