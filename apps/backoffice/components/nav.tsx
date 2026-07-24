"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";
import { Badge, Button } from "@zaroda/ui";

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
  { href: "/roster", label: "Roster" },
  { href: "/payroll", label: "Payroll" },
  { href: "/branches", label: "Branches" },
  { href: "/customers", label: "Customers" },
];

// Owner/manager only - a cashier-role session never sees this link, though
// the real authorization boundary is the API's @Roles() guard on the
// endpoint itself, not this UI check.
const MANAGER_LINKS = [{ href: "/settings/tax", label: "Tax Settings" }];
const MANAGER_ROLES = ["MANAGER", "OWNER"];

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
  const links = MANAGER_ROLES.includes(session.role) ? [...LINKS, ...MANAGER_LINKS] : LINKS;

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-6">
        <span className="whitespace-nowrap font-bold text-foreground">
          ZARODA <span className="text-primary-600">Back Office</span>
        </span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                pathname?.startsWith(link.href)
                  ? "font-medium text-primary-600"
                  : "text-secondary-500 hover:text-foreground"
              }
            >
              {link.label}
            </Link>
          ))}
          {verticalLink && (
            <Link
              href={verticalLink.href}
              className={
                pathname?.startsWith(verticalLink.href)
                  ? "font-medium text-warning-600"
                  : "text-warning-600/70 hover:text-warning-600"
              }
            >
              {verticalLink.label}
            </Link>
          )}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <Badge variant="neutral">{session.industryType || "?"}</Badge>
        <span className="hidden text-secondary-500 sm:inline">
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
          Log out
        </Button>
      </div>
    </header>
  );
}
