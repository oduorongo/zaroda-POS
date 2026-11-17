"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RibbonButton, RibbonLink, ThemeToggle, TopRibbon } from "@zaroda/ui";
import { schoolHome } from "./shop-only";
import { displayPhone } from "../lib/format";
import { useStore } from "./store-provider";

// The same navy top ribbon as the back office and Zaroda Events: logo and name, then the menu, which wraps
// onto a second row on a phone instead of overflowing.
export default function Header() {
  const { buyer, ready, signOut } = useStore();
  const school = schoolHome(usePathname());

  // A school opening its supplier's link sees only that: no marketplace menus.
  if (school) {
    return (
      <TopRibbon appName="School ordering" homeHref={school} LinkComponent={Link}>
        <ThemeToggle />
      </TopRibbon>
    );
  }

  return (
    <TopRibbon appName="Marketplace" homeHref="/" LinkComponent={Link}>
      <RibbonLink href="/" LinkComponent={Link}>
        Shops
      </RibbonLink>
      <RibbonLink href="/hotels" LinkComponent={Link}>
        Hotels
      </RibbonLink>
      <RibbonLink href="/houses" LinkComponent={Link}>
        Houses to let
      </RibbonLink>
      {ready && buyer ? (
        <>
          <RibbonLink href="/orders" LinkComponent={Link}>
            My orders
          </RibbonLink>
          <span className="hidden text-xs text-white/70 md:inline">{buyer.name ?? buyer.email ?? (buyer.phone ? displayPhone(buyer.phone) : "My account")}</span>
          <RibbonButton onClick={signOut}>Sign out</RibbonButton>
        </>
      ) : (
        ready && (
          <RibbonLink href="/orders" LinkComponent={Link}>
            Sign in
          </RibbonLink>
        )
      )}
      <ThemeToggle />
    </TopRibbon>
  );
}
