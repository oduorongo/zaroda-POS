import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Barcode, QrCode, Calculator, FileText, PackageSearch, Users } from "lucide-react";
import { Card, CardContent, Badge } from "@zaroda/ui";

export const metadata: Metadata = {
  title: "Free Business Tools — Zaroda POS",
  description: "Free, browser-based tools for Kenyan shops — barcode generator, QR & WiFi QR codes, profit margin calculator, and invoice generator. No sign-up required.",
  alternates: { canonical: "https://zarodashop.com/tools" },
};

type Tool = {
  icon: LucideIcon;
  color: string;
  title: string;
  description: string;
  href: string;
  comingSoon?: boolean;
};

const TOOLS: Tool[] = [
  {
    icon: Barcode,
    color: "bg-primary-600",
    title: "Barcode Generator",
    description: "Generate CODE128 or EAN-13 barcodes and download them as PNG.",
    href: "/tools/barcode",
  },
  {
    icon: QrCode,
    color: "bg-accent-500",
    title: "QR Code Generator",
    description: "Turn a link or WiFi network into a scannable QR code.",
    href: "/tools/qr",
  },
  {
    icon: Calculator,
    color: "bg-primary-600",
    title: "Profit Margin Calculator",
    description: "Work out profit, margin %, and markup % in KES — or reverse it to find a selling price.",
    href: "/tools/margin",
  },
  {
    icon: FileText,
    color: "bg-secondary-700",
    title: "Invoice Generator",
    description: "Build a line-item invoice with tax and totals, then export it as a PDF.",
    href: "/tools/invoice",
  },
  {
    icon: PackageSearch,
    color: "bg-secondary-400",
    title: "Stock Reorder Calculator",
    description: "Work out reorder points from sales velocity and lead time.",
    href: "#",
    comingSoon: true,
  },
  {
    icon: Users,
    color: "bg-secondary-400",
    title: "Staff Shift Planner",
    description: "Draft a weekly shift roster for your branch.",
    href: "#",
    comingSoon: true,
  },
];

export default function ToolsPage() {
  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <Badge variant="primary">Free tools</Badge>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground">Free business tools</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-secondary-500">
          Practical tools for running a Kenyan shop — no sign-up, nothing sent to a server. They run right
          here in your browser.
        </p>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const content = (
                <Card
                  className={`flex h-full flex-col transition-shadow ${
                    tool.comingSoon ? "opacity-60" : "group-hover:shadow-md group-hover:border-primary-600/40"
                  }`}
                >
                  <CardContent className="flex h-full flex-col">
                    <div className="flex items-center justify-between">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tool.color} text-white`}>
                        <Icon size={20} strokeWidth={2} />
                      </div>
                      {tool.comingSoon && <Badge variant="neutral">Coming soon</Badge>}
                    </div>
                    <h2 className="mt-4 font-semibold text-foreground">{tool.title}</h2>
                    <p className="mt-1.5 flex-1 text-sm text-secondary-500">{tool.description}</p>
                  </CardContent>
                </Card>
              );

              if (tool.comingSoon) {
                return (
                  <div key={tool.title} className="cursor-not-allowed" aria-disabled="true">
                    {content}
                  </div>
                );
              }

              return (
                <Link key={tool.title} href={tool.href} className="group block h-full">
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface py-16 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-2xl font-bold text-foreground">Want these built into your till?</h2>
          <p className="mt-2 text-secondary-500">
            Zaroda POS handles barcodes, receipts, and reporting automatically at the point of sale.
          </p>
          <Link href="/signup" className="mt-6 inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700">
            Start free trial
          </Link>
        </div>
      </section>
    </main>
  );
}
