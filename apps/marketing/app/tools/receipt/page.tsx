import type { Metadata } from "next";
import ReceiptClient from "./receipt-client";

export const metadata: Metadata = {
  title: "Receipt Generator — Free Tools — Zaroda POS",
  description: "Create a printable thermal-style receipt in KES and export it as a PDF — free, no sign-up.",
  alternates: { canonical: "https://zarodashop.com/tools/receipt" },
};

export default function ReceiptToolPage() {
  return <ReceiptClient />;
}
