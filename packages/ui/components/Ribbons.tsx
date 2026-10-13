import type { ElementType, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The two navy "ribbons" every Zaroda web app shares with Zaroda Events: a sticky bar across the top (logo,
 * app name in gold, a menu that wraps onto a second row on a phone instead of overflowing) and a sticky
 * bar across the bottom ("Powered by ZARODA SOLUTIONS", shortened on a phone). Deliberately a fixed navy in
 * both light and dark mode, like Events - they are the brand frame around the page, not part of its theme.
 */
const NAVY = "bg-[#0a1633]";
const GOLD_TEXT = "text-[#c99a2e]";
const GOLD_BORDER = "border-[#c99a2e]";

export interface TopRibbonProps {
  /** Shown in gold beside the logo, e.g. "Back Office". */
  appName: string;
  /** Where the logo and name lead. */
  homeHref: string;
  /** Pass the framework's link component (next/link) so moving about stays a client-side navigation. */
  LinkComponent?: ElementType;
  /** A white logo, served by the app. */
  logoSrc?: string;
  /** The menu: RibbonLink / RibbonButton items, small extras, the theme switch. */
  children?: ReactNode;
  className?: string;
}

export function TopRibbon({ appName, homeHref, LinkComponent = "a", logoSrc = "/zaroda-logo-white.png", children, className }: TopRibbonProps) {
  const Brand = LinkComponent;
  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-white sm:px-4 sm:py-3",
        "shadow-[0_2px_10px_rgba(5,12,35,0.25)]",
        NAVY,
        className,
      )}
    >
      <Brand href={homeHref} className="inline-flex items-center gap-2 no-underline" aria-label={`Zaroda ${appName} home`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed brand asset; no optimisation needed */}
        <img src={logoSrc} alt="Zaroda Solutions" width={147} height={120} className="block h-10 w-auto sm:h-12" />
        <span className={cn("whitespace-nowrap border-l border-white/35 pl-2.5 text-sm font-extrabold tracking-wider sm:text-base", GOLD_TEXT)}>{appName}</span>
      </Brand>
      <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:gap-x-4">{children}</nav>
    </header>
  );
}

const ribbonItem = (active?: boolean) =>
  cn("border-b-2 no-underline transition-opacity", active ? cn("opacity-100", GOLD_BORDER) : "border-transparent opacity-85 hover:opacity-100");

/** A menu link in the ribbon; the current page is underlined in gold. */
export function RibbonLink({
  href,
  active,
  LinkComponent = "a",
  className,
  children,
}: {
  href: string;
  active?: boolean;
  LinkComponent?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const Item = LinkComponent;
  return (
    <Item href={href} className={cn(ribbonItem(active), "inline-flex items-center gap-1.5", className)} aria-current={active ? "page" : undefined}>
      {children}
    </Item>
  );
}

/** A menu item that does something rather than going somewhere (Sign out). */
export function RibbonButton({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("cursor-pointer border-b-2 border-transparent bg-transparent p-0 opacity-85 hover:opacity-100", className)}>
      {children}
    </button>
  );
}

/** The bottom ribbon. On a phone it shrinks to just "ZARODA SOLUTIONS" so the two ribbons leave room for the page. */
export function BottomRibbon({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <footer
      className={cn(
        "sticky bottom-0 z-40 px-2 py-1.5 text-center text-[0.72rem] text-white/80 sm:px-4 sm:py-2.5 sm:text-[0.8rem]",
        "shadow-[0_-2px_10px_rgba(5,12,35,0.25)]",
        NAVY,
        className,
      )}
    >
      <span className="hidden sm:inline">Powered by </span>
      <strong className="text-white">ZARODA SOLUTIONS</strong>
      <span className="hidden sm:inline"> - Innovative. Reliable. Forward.</span>
      {children}
    </footer>
  );
}
