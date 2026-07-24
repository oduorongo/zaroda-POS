import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zaroda POS — Point of Sale for Kenyan Retail",
  description: "Rent-to-run POS for supermarkets, minimarts, pharmacies, agrovets, and more — M-Pesa built in, works offline.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-bold text-foreground">
              ZARODA <span className="text-primary-600">POS</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm">
              <Link href="/pricing" className="text-secondary-600 hover:text-foreground">Pricing</Link>
              <Link href="/signup" className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700">
                Start free trial
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="border-t border-border bg-surface py-8 text-center text-sm text-secondary-500">
          Zaroda POS — built for Kenyan retail. M-Pesa, KES, eTIMS-ready.
        </footer>
      </body>
    </html>
  );
}
