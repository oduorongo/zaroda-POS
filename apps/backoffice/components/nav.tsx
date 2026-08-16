"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, ExternalLink } from "lucide-react";
import { clearSession, type Session } from "../lib/auth";
import { useIdleLogout } from "../hooks/use-idle-logout";
import { Badge, Button, ThemeToggle } from "@zaroda/ui";

// A handful of the most-used screens, kept in the top bar for quick access.
// The full set of screens lives on the /dashboard tile grid.
const QUICK_LINKS = [
  { href: "/sales", label: "Sales" },
  { href: "/products", label: "Products" },
  { href: "/reports", label: "Reports" },
];

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://zarodashop.com";

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
  useIdleLogout();

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-6">
        <div className="flex flex-col">
          <a
            href={MARKETING_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 whitespace-nowrap text-xs text-secondary-400 hover:text-foreground"
            title="Leaves the back office for the public Zaroda site"
          >
            zarodashop.com
            <ExternalLink size={11} />
          </a>
          <Link href="/dashboard" className="whitespace-nowrap font-bold text-foreground">
            ZARODA <span className="text-primary-600">Back Office</span>
          </Link>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/dashboard"
            className={
              pathname === "/dashboard"
                ? "flex items-center gap-1.5 font-medium text-primary-600"
                : "flex items-center gap-1.5 text-secondary-500 hover:text-foreground"
            }
          >
            <LayoutGrid size={15} />
            Home
          </Link>
          {QUICK_LINKS.map((link) => (
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
        <ThemeToggle />
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
    </header>
  );
}
