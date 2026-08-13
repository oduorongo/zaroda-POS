import type { Metadata } from "next";
import BarcodeClient from "./barcode-client";

export const metadata: Metadata = {
  title: "Barcode Generator — Free Tools — Zaroda POS",
  description: "Generate CODE128 or EAN-13 barcodes free in your browser and download them as PNG.",
  alternates: { canonical: "https://zarodashop.com/tools/barcode" },
};

export default function BarcodeToolPage() {
  return <BarcodeClient />;
}
