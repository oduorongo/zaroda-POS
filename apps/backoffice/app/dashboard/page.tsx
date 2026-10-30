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
  Store,
  ShoppingBag,
  Banknote,
  ScanBarcode,
  ClipboardCheck,
  TrendingUp,
  BookOpen,
  UtensilsCrossed,
  BedDouble,
  Pill,
  Scissors,
  Factory,
  Wrench,
  Home,
  GraduationCap,
  ConciergeBell,
  FileText,
  Tags,
} from "lucide-react";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { useIdleLogout } from "../../hooks/use-idle-logout";
import { Nav } from "../../components/nav";


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
const MANAGER_TILES: Tile[] = [
  {
    href: "/stock-take",
    label: "Stock count",
    description: "Count your shelves by scanning, and fix the stock.",
    icon: ClipboardCheck,
    tone: "bg-teal-600",
  },
  {
    href: "/labels",
    label: "Barcode labels",
    description: "Print barcode labels for your products.",
    icon: ScanBarcode,
    tone: "bg-slate-600",
  },
  {
    href: "/profit",
    label: "Profit & loss",
    description: "What you really made: sales less costs and expenses, by day, week or month.",
    icon: TrendingUp,
    tone: "bg-green-600",
  },
  {
    href: "/accounting",
    label: "Accounts (books)",
    description: "Double-entry books: trial balance, profit and loss, balance sheet and journals, posted for you.",
    icon: BookOpen,
    tone: "bg-sky-700",
  },
  {
    href: "/expenses",
    label: "Expenses",
    description: "Record rent, power, transport and other money you spend.",
    icon: Banknote,
    tone: "bg-rose-600",
  },
  {
    href: "/settings/tax",
    label: "Tax Settings",
    description: "VAT rates and tax-class configuration.",
    icon: Receipt,
    tone: "bg-secondary-500",
  },
  {
    href: "/online-orders",
    label: "Online Orders",
    description: "Accept, prepare, and hand over orders from your online shop.",
    icon: ShoppingBag,
    tone: "bg-emerald-600",
  },
  {
    href: "/settings/online-shop",
    label: "Online Shop",
    description: "Your public shop link, payments, and pickup/delivery.",
    icon: Store,
    tone: "bg-emerald-600",
  },
];
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
  RENTAL: {
    href: "/rentals",
    label: "Rentals",
    description: "Properties, units, tenants and leases.",
    icon: Home,
    tone: "bg-amber-600",
  },
  HOTEL: {
    href: "/front-desk",
    label: "Front desk",
    description: "Today's arrivals, guests in the house, departures, and the room grid.",
    icon: ConciergeBell,
    tone: "bg-amber-600",
  },
  SCHOOL_SUPPLIER: {
    href: "/school-orders",
    label: "School orders",
    description: "Orders from schools to confirm and deliver.",
    icon: ClipboardList,
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
  useIdleLogout();

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (s.industryType === "CONSTRUCTION") {
      router.replace("/construction");
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
    ? [...TILES, ...MANAGER_TILES]
    : TILES;
  if (verticalTile) tiles.push(verticalTile);
  // A school supplier also gets the schools, the school price list and the money screens.
  if (session.industryType === "SCHOOL_SUPPLIER") {
    tiles.push(
      { href: "/schools", label: "Schools", description: "The schools you supply, their PINs and ordering link.", icon: GraduationCap, tone: "bg-amber-600" },
      { href: "/school-prices", label: "School price list", description: "What schools can order and what they pay.", icon: Tags, tone: "bg-amber-600" },
      { href: "/school-money", label: "Invoices & payments", description: "Who owes you, invoices, cheques and receipts.", icon: FileText, tone: "bg-amber-600" },
    );
  }
  // A restaurant that also lets rooms: front desk, rooms, housekeeping, bookings and photos. A hotel gets them too, plus its restaurant.
  if ((session.industryType === "RESTAURANT" || session.industryType === "HOTEL") && MANAGER_ROLES.includes(session.role)) {
    if (session.industryType === "RESTAURANT") tiles.push({ href: "/front-desk", label: "Front desk", description: "Arrivals, guests in the house, check-in and check-out.", icon: ConciergeBell, tone: "bg-amber-600" });
    tiles.push({ href: "/rooms", label: "Rooms & housekeeping", description: "Your rooms, room types, bookings and housekeeping.", icon: BedDouble, tone: "bg-amber-600" });
    if (session.industryType === "HOTEL") tiles.push({ href: "/restaurant", label: "Restaurant", description: "Tables, kitchen and open bills (optional for a hotel).", icon: UtensilsCrossed, tone: "bg-amber-600" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1d3f75] via-[#16305c] to-[#0a1730] px-6 py-7 text-white shadow-[0_10px_30px_-10px_rgb(10_23_48/0.6)] sm:px-8 sm:py-9">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-sky-400/10 blur-2xl" />
          <h1 className="relative text-2xl font-bold sm:text-3xl">Welcome back{session.email ? `, ${session.email.split("@")[0]}` : ""}</h1>
          <p className="relative mt-1.5 text-sm text-white/70">Everything for your shop, in one place.</p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="group flex flex-col rounded-xl border border-border bg-surface p-5 shadow-[var(--card-shadow)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-500/40 hover:shadow-[0_12px_28px_-10px_rgb(15_23_42/0.28)]"
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tile.tone} text-white shadow-md ring-1 ring-white/20 transition-transform duration-200 group-hover:scale-105`}>
                  <Icon size={22} strokeWidth={2} />
                </div>
                <h2 className="mt-4 font-semibold text-foreground">{tile.label}</h2>
                <p className="mt-1 text-sm text-secondary-400">{tile.description}</p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
