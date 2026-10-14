"use client";

import Link from "next/link";
import { RibbonLink, ThemeToggle, TopRibbon } from "@zaroda/ui";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/industries", label: "Industries" },
  { href: "/tools", label: "Tools" },
  { href: "/pricing", label: "Pricing" },
];

const BACKOFFICE_URL = process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3003";
const BACKOFFICE_LOGIN_URL = `${BACKOFFICE_URL}/login`;

// The same navy top ribbon as the back office, platform admin and shop; the menu wraps on a phone.
export default function Nav() {
  return (
    <TopRibbon appName="Zaroda POS" homeHref="/" LinkComponent={Link}>
      {LINKS.map((link) => (
        <RibbonLink key={link.href} href={link.href} LinkComponent={Link}>
          {link.label}
        </RibbonLink>
      ))}
      <RibbonLink href={BACKOFFICE_LOGIN_URL}>Sign In</RibbonLink>
      <Link href="/signup" className="rounded-md bg-[#c99a2e] px-3 py-1 font-semibold text-[#0a1633] no-underline hover:opacity-90">
        Start Free Trial
      </Link>
      <ThemeToggle />
    </TopRibbon>
  );
}
