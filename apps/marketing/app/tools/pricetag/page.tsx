import type { Metadata } from "next";
import PriceTagClient from "./pricetag-client";

export const metadata: Metadata = {
  title: "Price Tag Generator — Free Tools — Zaroda POS",
  description: "Create printable price tags in KES with an optional barcode — free, no sign-up.",
  alternates: { canonical: "https://zarodashop.com/tools/pricetag" },
};

export default function PriceTagToolPage() {
  return <PriceTagClient />;
}
