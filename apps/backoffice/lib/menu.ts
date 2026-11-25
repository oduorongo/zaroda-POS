import type { LucideIcon } from "lucide-react";
import {
  BarChart3, BedDouble, BookOpen, Boxes, BrainCircuit, Building2, CalendarDays, ClipboardCheck, ClipboardList, Coins, ConciergeBell,
  Factory, FileText, FolderKanban, GraduationCap, HardHat, Home, LayoutGrid, LifeBuoy, Mail, MapPinned, Package, PackageOpen, PiggyBank,
  Pill, Receipt, ScanBarcode, Scissors, Settings, ShieldCheck, Shirt, ShoppingBag, ShoppingCart, Store, Tags, Tractor, Trash2,
  TrendingUp, Truck, UserRound, Users, UtensilsCrossed, Wallet, Banknote, Clock, Wrench, Beef, HeartPulse, Layers, Gavel, Milk, Egg,
} from "lucide-react";
import type { Session } from "./auth";

const TERMINAL_URL = process.env.NEXT_PUBLIC_TERMINAL_URL ?? "https://pos.zarodashop.com";
import { hasConRole, isDirector, type ConMe } from "./construction";

export type MenuItem = { href: string; label: string; icon: LucideIcon; group: string; match?: string[] };
type Def = MenuItem & { roles?: readonly string[]; types?: string[]; hideFor?: string[] };

const OFFICE = ["OWNER", "MANAGER", "AUDITOR"];
const MGR = ["OWNER", "MANAGER"];
const SUP = ["OWNER", "MANAGER", "AUDITOR", "SUPERVISOR"];
const ALL = ["OWNER", "MANAGER", "AUDITOR", "SUPERVISOR", "CASHIER"];

// The POS back office (every business type except rentals, construction and farms). Default roles: OFFICE.
const POS: Def[] = [
  { group: "Main", href: "/dashboard", label: "Home", icon: LayoutGrid, roles: ALL },
  { group: "Main", href: "/sales", label: "Sales", icon: ShoppingCart, roles: ALL },
  { group: "Main", href: "/shifts", label: "Shifts", icon: Clock, roles: SUP },
  { group: "Main", href: "/reports", label: "Reports", icon: BarChart3, roles: SUP },
  { group: "Main", href: "/insights", label: "AI Business Analyser", icon: BrainCircuit, roles: MGR },

  { group: "Your business", href: "/restaurant", label: "Tables & Kitchen", icon: UtensilsCrossed, roles: SUP, types: ["RESTAURANT", "HOTEL"] },
  { group: "Your business", href: "/front-desk", label: "Front desk", icon: ConciergeBell, roles: SUP, types: ["HOTEL", "RESTAURANT"] },
  { group: "Your business", href: "/rooms", label: "Rooms & housekeeping", icon: BedDouble, roles: MGR, types: ["HOTEL", "RESTAURANT"] },
  { group: "Your business", href: "/pharmacy", label: "Pharmacy", icon: Pill, types: ["PHARMACY"] },
  { group: "Your business", href: "/bookings", label: "Bookings", icon: Scissors, roles: SUP, types: ["SALON"] },
  { group: "Your business", href: "/manufacturing", label: "Production", icon: Factory, roles: SUP, types: ["MANUFACTURING"] },
  { group: "Your business", href: "/service-jobs", label: "Job Orders", icon: Wrench, roles: SUP, types: ["SERVICE"] },
  { group: "Your business", href: "/school-orders", label: "School orders", icon: ClipboardList, types: ["SCHOOL_SUPPLIER", "UNIFORM_MAKER"] },
  { group: "Your business", href: "/schools", label: "Schools", icon: GraduationCap, types: ["SCHOOL_SUPPLIER", "UNIFORM_MAKER"] },
  { group: "Your business", href: "/school-prices", label: "School price list", icon: Tags, types: ["SCHOOL_SUPPLIER", "UNIFORM_MAKER"] },
  { group: "Your business", href: "/school-money", label: "Invoices & payments", icon: FileText, types: ["SCHOOL_SUPPLIER", "UNIFORM_MAKER"] },
  { group: "Your business", href: "/tailoring", label: "Tailoring", icon: Shirt, types: ["UNIFORM_MAKER"] },

  { group: "Stock", href: "/products", label: "Products", icon: Package },
  { group: "Stock", href: "/categories", label: "Categories", icon: Tags },
  { group: "Stock", href: "/inventory", label: "Inventory", icon: Boxes, roles: SUP },
  { group: "Stock", href: "/stock-take", label: "Stock count", icon: ClipboardCheck, roles: ["OWNER", "MANAGER", "SUPERVISOR"] },
  { group: "Stock", href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { group: "Stock", href: "/repackaging", label: "Repackaging", icon: PackageOpen, hideFor: ["HOTEL", "RESTAURANT", "SALON", "SERVICE"] },
  { group: "Stock", href: "/waste", label: "Waste", icon: Trash2, roles: ["OWNER", "MANAGER", "SUPERVISOR"] },
  { group: "Stock", href: "/labels", label: "Barcode labels", icon: ScanBarcode, roles: MGR, hideFor: ["HOTEL", "SALON", "RESTAURANT"] },

  { group: "Customers", href: "/customers", label: "Customers", icon: UserRound, roles: SUP },
  { group: "Customers", href: "/layaways", label: "Lipa polepole", icon: PiggyBank, roles: SUP, hideFor: ["HOTEL", "RESTAURANT", "SALON", "SERVICE", "MANUFACTURING"] },
  { group: "Customers", href: "/online-orders", label: "Online Orders", icon: ShoppingBag, roles: ["OWNER", "MANAGER", "SUPERVISOR"], hideFor: ["HOTEL"] },
  { group: "Customers", href: "/settings/online-shop", label: "Online Shop", icon: Store, roles: MGR },

  { group: "People", href: "/staff", label: "Staff", icon: Users },
  { group: "People", href: "/roster", label: "Roster", icon: CalendarDays, roles: SUP },
  { group: "People", href: "/payroll", label: "Payroll", icon: Wallet },
  { group: "People", href: "/branches", label: "Branches", icon: Building2 },

  { group: "Money", href: "/profit", label: "Profit & loss", icon: TrendingUp, roles: MGR },
  { group: "Money", href: "/accounting", label: "Accounts (books)", icon: BookOpen, roles: MGR },
  { group: "Money", href: "/expenses", label: "Expenses", icon: Banknote, roles: MGR },
  { group: "Money", href: "/petty-cash", label: "Petty cash", icon: Coins, roles: MGR },
  { group: "Money", href: "/settings/tax", label: "Tax Settings", icon: Receipt, roles: MGR },
  { group: "Money", href: "/settings/etims", label: "KRA eTIMS", icon: FileText },
  { group: "Money", href: "/subscription", label: "My subscription", icon: Receipt, roles: MGR, types: ["SCHOOL_SUPPLIER", "UNIFORM_MAKER"] },

  { group: "Help", href: "/guide", label: "Guide", icon: LifeBuoy, roles: ALL },
];

const RENTALS: Def[] = [
  { group: "Main", href: "/rentals", label: "Rentals", icon: Home, roles: [...OFFICE, "CARETAKER"], match: [] },
  { group: "Money", href: "/accounting", label: "Accounts", icon: BookOpen },
  { group: "Money", href: "/petty-cash", label: "Petty cash", icon: Coins },
  { group: "People", href: "/staff", label: "Staff", icon: Users },
  { group: "Help", href: "/rentals/guide", label: "Guide", icon: LifeBuoy, roles: [...OFFICE, "CARETAKER"] },
];

const CONSTRUCTION: Def[] = [
  { group: "Main", href: "/construction", label: "Home", icon: LayoutGrid, roles: SUP },
  { group: "Main", href: "/construction/projects", label: "Projects", icon: FolderKanban, roles: SUP },
  { group: "Main", href: "/construction/site", label: "Site", icon: HardHat, roles: SUP },
  { group: "Main", href: "/construction/workers", label: "Workers", icon: Users, roles: SUP },
  { group: "Main", href: "/construction/plant", label: "Plant", icon: Truck, roles: SUP },
  { group: "Main", href: "/construction/tenders", label: "Tenders", icon: Gavel, roles: SUP },
  { group: "Main", href: "/construction/compliance", label: "Compliance", icon: ShieldCheck, roles: SUP },
  { group: "Main", href: "/construction/reports", label: "Reports", icon: BarChart3, roles: SUP },
  { group: "Main", href: "/construction/messages", label: "Messages", icon: Mail, roles: SUP },
  { group: "Money", href: "/accounting", label: "Accounts", icon: BookOpen, roles: MGR },
  { group: "Money", href: "/petty-cash", label: "Petty cash", icon: Coins, roles: MGR },
  { group: "Money", href: "/suppliers", label: "Suppliers", icon: Truck, roles: MGR },
  { group: "Money", href: "/construction/materials", label: "Materials", icon: Boxes, roles: MGR },
  { group: "Settings", href: "/construction/plan", label: "Plan", icon: Receipt, roles: SUP },
  { group: "Settings", href: "/construction/settings", label: "Settings", icon: Settings, roles: SUP },
  { group: "Help", href: "/construction/guide", label: "Guide", icon: LifeBuoy, roles: SUP },
];

const FARM: Def[] = [
  { group: "Main", href: "/shamba", label: "Farm", icon: Tractor, roles: SUP },
  { group: "Main", href: "/shamba/animals", label: "Animals", icon: Beef, roles: SUP, match: ["/shamba/groups"] },
  { group: "Main", href: "/shamba/health", label: "Health", icon: HeartPulse, roles: SUP },
  { group: "Production", href: "/shamba/milk", label: "Milk", icon: Milk, roles: SUP },
  { group: "Production", href: "/shamba/eggs", label: "Eggs", icon: Egg, roles: SUP },
  { group: "Production", href: "/shamba/production", label: "Yields & produce", icon: BarChart3, roles: SUP },
  { group: "Selling", href: "/sales", label: "Sales", icon: ShoppingCart, roles: SUP },
  { group: "Selling", href: "/products", label: "Products & prices", icon: Package, roles: MGR },
  { group: "Selling", href: "/inventory", label: "Stock", icon: Boxes, roles: SUP },
  { group: "Selling", href: "/customers", label: "Buyers", icon: UserRound, roles: SUP },
  { group: "Selling", href: TERMINAL_URL, label: "Open the till", icon: Store, roles: SUP },
  { group: "Farm setup", href: "/shamba/layout", label: "Layout", icon: MapPinned, roles: SUP },
  { group: "Farm setup", href: "/shamba/enterprises", label: "Enterprises", icon: Layers, roles: SUP },
  { group: "Farm setup", href: "/shamba/staff", label: "Staff", icon: Users, roles: SUP },
  { group: "Help", href: "/shamba/guide", label: "Guide", icon: LifeBuoy, roles: SUP },
];

function defsFor(industryType: string): Def[] {
  if (industryType === "RENTAL") return RENTALS;
  if (industryType === "CONSTRUCTION") return CONSTRUCTION;
  if (industryType === "FARM") return FARM;
  return POS;
}

/** The sidebar for this person: only what their role and business type allow (the API re-checks every request). */
export function menuFor(session: Pick<Session, "role" | "industryType">, me?: ConMe | null): MenuItem[] {
  const t = session.industryType;
  const items = defsFor(t).filter(
    (d) => (d.roles ?? OFFICE).includes(session.role) && (!d.types || d.types.includes(t)) && !d.hideFor?.includes(t),
  );
  if (t === "CONSTRUCTION") {
    const at = items.findIndex((i) => i.group === "Settings");
    const extra: Def[] = [
      ...(hasConRole(me ?? null, "CON_COMPLIANCE") ? [{ group: "Settings", href: "/construction/staff", label: "Staff & roles", icon: Users }] : []),
      ...(isDirector(me ?? null) ? [{ group: "Settings", href: "/construction/enterprise", label: "Offices & API", icon: Building2 }] : []),
    ];
    items.splice(at < 0 ? items.length : at, 0, ...extra);
  }
  return items.map(({ group, href, label, icon, match }) => ({ group, href, label, icon, match }));
}

// Signed-in pages anyone may open whatever their menu (the page or the API still decides what they see).
const ALWAYS = ["/dashboard", "/guide", "/hotel-print", "/rentals/print"];

/**
 * Supervisors, cashiers and caretakers stay on their menu: any other back-office page sends them home. Owners, managers and
 * auditors, construction and farm staff are not limited here (those screens check their own roles).
 */
export function limitedTo(session: Pick<Session, "role" | "industryType">): string[] | null {
  if (!["SUPERVISOR", "CASHIER", "CARETAKER"].includes(session.role)) return null;
  if (session.industryType === "CONSTRUCTION" || session.industryType === "FARM") return null;
  return [...ALWAYS, ...menuFor(session).flatMap((i) => [i.href, ...(i.match ?? [])])];
}
