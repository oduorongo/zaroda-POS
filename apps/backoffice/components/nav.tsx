"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";

const LINKS = [
  { href: "/sales", label: "Sales" },
  { href: "/products", label: "Products" },
  { href: "/reports", label: "Reports" },
  { href: "/shifts", label: "Shifts" },
  { href: "/inventory", label: "Inventory" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/repackaging", label: "Repackaging" },
  { href: "/waste", label: "Waste" },
  { href: "/layaways", label: "Layaways" },
  { href: "/staff", label: "Staff" },
  { href: "/payroll", label: "Payroll" },
  { href: "/branches", label: "Branches" },
];

// Vertical-specific screens, gated the same way the terminal PWA gates
// its own nav on device.industryType - a RETAIL (or any unrecognized)
// org just sees the plain links above, nothing extra.
const VERTICAL_LINKS: Record<string, { href: string; label: string }> = {
  RESTAURANT: { href: "/restaurant", label: "Tables & Kitchen" },
  PHARMACY: { href: "/pharmacy", label: "Pharmacy" },
  SALON: { href: "/bookings", label: "Bookings" },
  MANUFACTURING: { href: "/manufacturing", label: "Production" },
  SERVICE: { href: "/service-jobs", label: "Job Orders" },
};

export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();
  const verticalLink = VERTICAL_LINKS[session.industryType];

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
      <div className="flex items-center gap-6">
        <span className="font-bold">ZARODA Back Office</span>
        <nav className="flex gap-4 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname?.startsWith(link.href) ? "text-blue-400" : "text-slate-400 hover:text-slate-200"}
            >
              {link.label}
            </Link>
          ))}
          {verticalLink && (
            <Link
              href={verticalLink.href}
              className={pathname?.startsWith(verticalLink.href) ? "text-amber-400" : "text-amber-500/70 hover:text-amber-400"}
            >
              {verticalLink.label}
            </Link>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400">
          {session.industryType || "?"}
        </span>
        <span className="text-slate-400">
          {session.email} · {session.role}
        </span>
        <button
          onClick={() => {
            clearSession();
            router.replace("/login");
          }}
          className="rounded-md bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
