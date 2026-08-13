import type { Metadata } from "next";
import BusinessCardClient from "./businesscard-client";

export const metadata: Metadata = {
  title: "Business Card Generator — Free Tools — Zaroda POS",
  description: "Design a simple business card with your name, title, and contact details — download as PNG or PDF.",
  alternates: { canonical: "https://zarodashop.com/tools/businesscard" },
};

export default function BusinessCardToolPage() {
  return <BusinessCardClient />;
}
