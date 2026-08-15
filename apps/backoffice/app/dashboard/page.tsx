"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ShoppingCart,
  Package,
  Boxes,
  BarChart3,
  Clock,
  ClipboardList,
  Users,
  CalendarDays,
  Wallet,
  Building2,
  UserRound,
  PiggyBank,
  Trash2,
  PackageOpen,
  Receipt,
  UtensilsCrossed,
  Pill,
  Scissors,
  Factory,
  Wrench,
} from "lucide-react";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Badge, Button } from "@zaroda/ui";

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3005";

type Tile = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: string;
};

const TILES: Tile[] = [
  { href: "/sales", label: "Sales", description: "Today's transactions and till activity.", icon: ShoppingCart, tone: "bg-primary-600" },
  { href: "/products", label: "Products", description: "Manage your catalog, prices, and variants.", icon: Package, tone: "bg-purple-600" },
  { href: "/inventory", label: "Inventory", description: "Stock levels, batches, and stock-takes.", icon: Boxes, tone: "bg-teal-600" },
  { href: "/reports", label: "Reports", description: "Sales trends, Z-reports, and tax breakdowns.", icon: BarChart3, tone: "bg-green-600" },
  { href: "/shifts", label: "Shifts", description: "Cashier shift history and till reconciliation.", icon: Clock, tone: "bg-orange-600" },
  { href: "/purchase-orders", label: "Purchase Orders", description: "Orders placed with your suppliers.", icon: ClipboardList, tone: "bg-indigo-600" },
  { href: "/repackaging", label: "Repackaging", description: "Break bulk stock into sellable units.", icon: PackageOpen, tone: "bg-cyan-600" },
  { href: "/waste", label: "Waste", description: "Log damaged or expired stock write-offs.", icon: Trash2, tone: "bg-red-600" },
  { href: "/layaways", label: "Layaways", description: "Partial payments and outstanding balances.", icon: PiggyBank, tone: "bg-pink-600" },
  { href: "/staff", label: "Staff", description: "Team members, PINs, and roles.", icon: Users, tone: "bg-primary-600" },
  { href: "/roster", label: "Roster", description: "Plan and review staff shift schedules.", icon: CalendarDays, tone: "bg-purple-600" },
  { href: "/payroll", label: "Payroll", description: "Staff pay runs and payment history.", icon: Wallet, tone: "bg-teal-600" },
  { href: "/branches", label: "Branches", description: "Manage branches and their terminals.", icon: Building2, tone: "bg-orange-600" },
  { href: "/customers", label: "Customers", description: "Customer records and purchase history.", icon: UserRound, tone: "bg-indigo-600" },
];

// Mirrors components/nav.tsx exactly - owner/manager only, though the real
// authorization boundary is the API's @Roles() guard, not this UI check.
const MANAGER_TILE: Tile = {
  href: "/settings/tax",
  label: "Tax Settings",
  description: "VAT rates and tax-class configuration.",
  icon: Receipt,
  tone: "bg-slate-600",
};
const MANAGER_ROLES = ["MANAGER", "OWNER"];

// Same industryType gating as components/nav.tsx's VERTICAL_LINKS.
const VERTICAL_TILES: Record<string, Tile> = {
  RESTAURANT: {
    href: "/restaurant",
    label: "Tables & Kitchen",
    description: "Table status and kitchen order tickets.",
    icon: UtensilsCrossed,
    tone: "bg-amber-600",
  },
  PHARMACY: {
    href: "/pharmacy",
    label: "Pharmacy",
    description: "Prescription-flagged sales and stock.",
    icon: Pill,
    tone: "bg-amber-600",
  },
  SALON: {
    href: "/bookings",
    label: "Bookings",
    description: "Appointments and resource scheduling.",
    icon: Scissors,
    tone: "bg-amber-600",
  },
  MANUFACTURING: {
    href: "/manufacturing",
    label: "Production",
    description: "Production runs and recipe output.",
    icon: Factory,
    tone: "bg-amber-600",
  },
  SERVICE: {
    href: "/service-jobs",
    label: "Job Orders",
    description: "Service jobs and their status.",
    icon: Wrench,
    tone: "bg-amber-600",
  },
};

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSessionState(s);
  }, [router]);

  if (!session) return null;

  const verticalTile = VERTICAL_TILES[session.industryType];
  const tiles = MANAGER_ROLES.includes(session.role)
    ? [...TILES, MANAGER_TILE]
    : TILES;
  if (verticalTile) tiles.push(verticalTile);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <a href={MARKETING_URL} className="text-xs text-slate-500 hover:text-slate-300">
              ← zarodashop.com
            </a>
            <span className="font-bold">
              ZARODA <span className="text-primary-500">Back Office</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="neutral">{session.industryType || "?"}</Badge>
            <span className="hidden text-slate-400 sm:inline">
              {session.email} · {session.role}
            </span>
            <Button
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
              variant="secondary"
              size="sm"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-white">Welcome back{session.email ? `, ${session.email.split("@")[0]}` : ""}</h1>
        <p className="mt-1 text-sm text-slate-400">Everything for your shop, in one place.</p>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="group flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700 hover:bg-slate-800"
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tile.tone} text-white`}>
                  <Icon size={22} strokeWidth={2} />
                </div>
                <h2 className="mt-4 font-semibold text-white">{tile.label}</h2>
                <p className="mt-1 text-sm text-slate-400">{tile.description}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
