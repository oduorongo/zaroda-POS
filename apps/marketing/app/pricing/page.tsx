import type { Metadata } from "next";
import PricingClient from "./pricing-client";

export const metadata: Metadata = {
  title: "Pricing — Zaroda POS",
  description: "Simple, per-device KES pricing — Basic, Standard, and Premium plans with a free 14-day trial, plus an optional online shop at 3% on completed online orders.",
  alternates: { canonical: "https://zarodashop.com/pricing" },
};

export default function PricingPage() {
  return <PricingClient />;
}
