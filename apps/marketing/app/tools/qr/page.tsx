import type { Metadata } from "next";
import QrClient from "./qr-client";

export const metadata: Metadata = {
  title: "QR Code Generator — Free Tools — Zaroda POS",
  description: "Generate a free QR code for a link, text, or a WiFi network — download as PNG, no sign-up.",
  alternates: { canonical: "https://zarodashop.com/tools/qr" },
};

export default function QrToolPage() {
  return <QrClient />;
}
