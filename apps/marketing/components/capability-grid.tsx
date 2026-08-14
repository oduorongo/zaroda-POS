import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  MonitorSmartphone,
  Smartphone,
  Boxes,
  Building2,
  ShieldCheck,
  BarChart3,
  UtensilsCrossed,
  Pill,
  Scissors,
  Receipt,
  MessageSquareText,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@zaroda/ui";
import { FeatureIllustration, type IllustrationKey } from "./feature-illustrations";

type Tone = "primary" | "accent" | "secondary" | "warning" | "success" | "error";

type Capability = {
  icon: LucideIcon;
  color: string;
  tone: Tone;
  illustration: IllustrationKey;
  title: string;
  description: string;
  href: string;
};

const CAPABILITIES: Capability[] = [
  {
    icon: MonitorSmartphone,
    color: "bg-primary-600",
    tone: "primary",
    illustration: "pos",
    title: "Point of Sale",
    description: "Offline-first till that keeps ringing up sales with or without a connection.",
    href: "/signup",
  },
  {
    icon: Smartphone,
    color: "bg-accent-500",
    tone: "accent",
    illustration: "mpesa",
    title: "M-Pesa Checkout",
    description: "STK push built into the till — customers pay from their own phone.",
    href: "/features",
  },
  {
    icon: Boxes,
    color: "bg-primary-600",
    tone: "primary",
    illustration: "inventory",
    title: "Inventory & Stock-Takes",
    description: "Batches, branch transfers, and low-stock alerts before you run out.",
    href: "/features",
  },
  {
    icon: Building2,
    color: "bg-secondary-700",
    tone: "secondary",
    illustration: "branches",
    title: "Multi-Branch Dashboard",
    description: "Sales, stock, and staff across every branch in one back office.",
    href: "/features",
  },
  {
    icon: ShieldCheck,
    color: "bg-error-600",
    tone: "error",
    illustration: "staff",
    title: "Staff Accountability",
    description: "PIN logins on shared terminals — every void and discount logged to who approved it.",
    href: "/features",
  },
  {
    icon: BarChart3,
    color: "bg-primary-600",
    tone: "primary",
    illustration: "reporting",
    title: "Reporting",
    description: "Daily sales, Z-reports, and tax breakdowns without exporting a spreadsheet.",
    href: "/features",
  },
  {
    icon: UtensilsCrossed,
    color: "bg-warning-600",
    tone: "warning",
    illustration: "restaurant",
    title: "Restaurant Mode",
    description: "Table management and kitchen tickets (KDS) for a fast-moving counter.",
    href: "/industries",
  },
  {
    icon: Pill,
    color: "bg-success-600",
    tone: "success",
    illustration: "pharmacy",
    title: "Pharmacy Mode",
    description: "Prescription flags on sale items for a pharmacy till.",
    href: "/industries",
  },
  {
    icon: Scissors,
    color: "bg-secondary-700",
    tone: "secondary",
    illustration: "salon",
    title: "Salon Mode",
    description: "Appointments and resource booking alongside the checkout.",
    href: "/industries",
  },
  {
    icon: Receipt,
    color: "bg-primary-600",
    tone: "primary",
    illustration: "etims",
    title: "eTIMS / KRA Ready",
    description: "VAT breakdown and tax-class management, ready for eTIMS submission.",
    href: "/features",
  },
  {
    icon: MessageSquareText,
    color: "bg-accent-500",
    tone: "accent",
    illustration: "sms",
    title: "SMS/WhatsApp Receipts",
    description: "Receipts and stock alerts sent via Africa's Talking, no extra app required.",
    href: "/features",
  },
  {
    icon: Wallet,
    color: "bg-primary-600",
    tone: "primary",
    illustration: "layaway",
    title: "Layaway & Refunds",
    description: "Partial payments on layaway, and every refund logged against the sale.",
    href: "/features",
  },
];

export default function CapabilityGrid() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">Everything your business needs</h2>
          <p className="mt-2 text-secondary-500">
            One system for the till, the stockroom, and the back office — built around how Kenyan shops actually run.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {CAPABILITIES.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.title} href={c.href} className="group block h-full">
                <Card className="flex h-full flex-col transition-shadow group-hover:shadow-md group-hover:border-primary-600/40">
                  <CardContent className="flex h-full flex-col">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.color} text-white`}>
                      <Icon size={20} strokeWidth={2} />
                    </div>
                    <h3 className="mt-4 font-semibold text-foreground">{c.title}</h3>
                    <p className="mt-1.5 flex-1 text-sm text-secondary-500">{c.description}</p>
                    <FeatureIllustration illustration={c.illustration} tone={c.tone} className="mt-4 h-20" />

                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/signup"
            className="inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </section>
  );
}
