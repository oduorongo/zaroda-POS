import Link from "next/link";
import { BottomRibbon } from "@zaroda/ui";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "../components/header";
import InstallPrompt from "../components/install-prompt";
import { StoreProvider } from "../components/store-provider";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shop.zarodashop.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Zaroda Marketplace - shop local, pay with M-Pesa", template: "%s | Zaroda Marketplace" },
  description: "Buy from local Kenyan shops and pay with M-Pesa. Pick up in store or get it delivered.",
  openGraph: { siteName: "Zaroda Marketplace", type: "website", locale: "en_KE" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <StoreProvider>
          <Header />
          <main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-6">{children}</main>
          <InstallPrompt />
          <p className="px-4 pb-4 text-center text-xs text-secondary-500">Payments go directly to each shop through M-Pesa.</p>
          <BottomRibbon>
            <span className="hidden sm:inline"> · </span>
            <Link href="/rider" className="ml-2 text-[#c99a2e] hover:underline sm:ml-0">
              Deliver with Zaroda
            </Link>
            <span className="hidden sm:inline"> · </span>
            <Link href="/tenant" className="ml-2 text-[#c99a2e] hover:underline sm:ml-0">
              Tenants: my rent account
            </Link>
          </BottomRibbon>
        </StoreProvider>
      </body>
    </html>
  );
}
