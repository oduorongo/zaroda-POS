"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";
import { useIdleLogout } from "../hooks/use-idle-logout";
import { RibbonButton, RibbonLink, ThemeToggle, TopRibbon } from "@zaroda/ui";

const LINKS = [
  { href: "/organizations", label: "Tenants" },
  { href: "/tenants/new", label: "+ New tenant" },
  { href: "/billing", label: "Billing" },
  { href: "/commission", label: "Commission" },
  { href: "/rental-billing", label: "Rental billing" },
  { href: "/adverts", label: "Adverts" },
  { href: "/hospitality", label: "Hotels & dining" },
  { href: "/riders", label: "Riders" },
  { href: "/teams", label: "Teams" },
  { href: "/analytics", label: "Analytics" },
];

// The same navy top ribbon as the back office and Zaroda Events (the menu wraps onto a second row on a
// phone instead of running off the edge). A platform admin and a tenant owner can still tell their apps
// apart at a glance: the app name beside the logo says "Platform Admin", and the session storage and API
// tokens are namespaced separately (lib/auth.ts).
export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();
  useIdleLogout();

  return (
    <TopRibbon appName="Platform Admin" homeHref="/organizations" LinkComponent={Link}>
      {LINKS.map((link) => (
        <RibbonLink
          key={link.href}
          href={link.href}
          LinkComponent={Link}
          active={pathname === link.href || (link.href !== "/tenants/new" && !!pathname?.startsWith(link.href))}
        >
          {link.label}
        </RibbonLink>
      ))}
      <span className="hidden text-xs text-white/70 lg:inline">{session.email}</span>
      <ThemeToggle />
      <RibbonButton
        onClick={() => {
          clearSession();
          router.replace("/login");
        }}
      >
        Log out
      </RibbonButton>
    </TopRibbon>
  );
}
