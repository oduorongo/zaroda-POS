"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { clearSession, homePath, isCaretaker, setSession, type Session } from "../lib/auth";
import { useIdleLogout } from "../hooks/use-idle-logout";
import { RibbonButton, RibbonLink, ThemeToggle, TopRibbon } from "@zaroda/ui";

// A handful of the most-used screens, kept in the top bar for quick access.
// The full set of screens lives on the /dashboard tile grid.
const QUICK_LINKS = [
  { href: "/sales", label: "Sales" },
  { href: "/products", label: "Products" },
  { href: "/categories", label: "Categories" },
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
  RENTAL: { href: "/rentals", label: "Rentals" },
  SCHOOL_SUPPLIER: { href: "/school-orders", label: "School Orders" },
  HOTEL: { href: "/front-desk", label: "Front desk" },
};

// The navy top ribbon shared with Zaroda Events and the other web apps: logo and app name, then the menu,
// which wraps onto a second row on a phone instead of overflowing. It stays at the top while the page scrolls.
export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();
  const verticalLink = VERTICAL_LINKS[session.industryType];
  const caretaker = isCaretaker(session.role); // sees Rentals only
  useIdleLogout();

  // The shop's name goes in the ribbon. Sessions made before this existed do not have it yet, so fetch it once and keep it.
  const [orgName, setOrgName] = useState(session.orgName);
  useEffect(() => {
    if (session.orgName) return;
    apiGet<{ name?: string }>("/organizations/me")
      .then((org) => {
        if (!org.name) return;
        setOrgName(org.name);
        setSession({ ...session, orgName: org.name });
      })
      .catch(() => {});
  }, [session]);

  return (
    <TopRibbon appName={orgName ?? "Back Office"} homeHref={homePath(session.role)} LinkComponent={Link}>
      {orgName && <span className="hidden text-xs text-white/60 lg:inline">Back Office</span>}
      {!caretaker && (
      <RibbonLink href="/dashboard" LinkComponent={Link} active={pathname === "/dashboard"}>
        <LayoutGrid size={14} />
        Home
      </RibbonLink>
      )}
      {!caretaker && QUICK_LINKS.map((link) => (
        <RibbonLink key={link.href} href={link.href} LinkComponent={Link} active={!!pathname?.startsWith(link.href)}>
          {link.label}
        </RibbonLink>
      ))}
      {verticalLink && (
        <RibbonLink href={verticalLink.href} LinkComponent={Link} active={!!pathname?.startsWith(verticalLink.href)} className="text-amber-300">
          {verticalLink.label}
        </RibbonLink>
      )}
      {session.industryType === "HOTEL" && !caretaker && (
        <>
          <RibbonLink href="/rooms" LinkComponent={Link} active={!!pathname?.startsWith("/rooms")} className="text-amber-300">
            Rooms
          </RibbonLink>
          <RibbonLink href="/restaurant" LinkComponent={Link} active={!!pathname?.startsWith("/restaurant")} className="text-amber-300">
            Restaurant
          </RibbonLink>
        </>
      )}
      {session.industryType === "RESTAURANT" && !caretaker && (
        <RibbonLink href="/rooms" LinkComponent={Link} active={!!pathname?.startsWith("/rooms")} className="text-amber-300">
          Rooms
        </RibbonLink>
      )}
      <a
        href={MARKETING_URL}
        target="_blank"
        rel="noreferrer"
        title="Leaves the back office for the public Zaroda site"
        className="hidden items-center gap-1 text-xs text-white/70 no-underline hover:text-white lg:inline-flex"
      >
        zarodashop.com
        <ExternalLink size={11} />
      </a>
      <span className="hidden text-xs text-white/70 md:inline">
        {session.industryType || "?"} · {session.email} · {session.role}
      </span>
      <ThemeToggle />
      <RibbonButton
        onClick={() => {
          clearSession();
          router.replace("/login");
        }}
      >
        Sign out
      </RibbonButton>
    </TopRibbon>
  );
}
