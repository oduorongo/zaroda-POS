"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { ThemeToggle } from "@zaroda/ui";
import type { MenuItem } from "../lib/menu";

const NAVY = "#0f1f45";
const GOLD = "#d4af37";

type Props = {
  title: string;
  subtitle?: string;
  homeHref: string;
  items: MenuItem[];
  user?: string;
  actions?: ReactNode;
  onSignOut: () => void;
};

/** The longest menu entry the current page sits under, so only one entry is highlighted. */
function activeHref(pathname: string, items: MenuItem[]): string | undefined {
  const hits = items.filter((i) => [i.href, ...(i.match ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`)));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/**
 * The left sidebar every signed-in screen shares (like Zaroda School): fixed on a computer, a slide-out drawer on a phone. It lists
 * only what lib/menu.ts allows for the person's role and business type, and scrolls when the list is long.
 */
export function SideNav({ title, subtitle, homeHref, items, user, actions, onSignOut }: Props) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const active = activeHref(pathname, items);

  useEffect(() => {
    document.body.classList.add("has-sidenav");
    return () => document.body.classList.remove("has-sidenav");
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = items.reduce<[string, MenuItem[]][]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last[0] === item.group) last[1].push(item);
    else acc.push([item.group, [item]]);
    return acc;
  }, []);

  const panel = (
    <div className="flex h-full flex-col text-white" style={{ background: NAVY }}>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <Link href={homeHref} className="flex min-w-0 items-center gap-3 no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zaroda-logo-white.png" alt="Zaroda" className="h-9 w-auto shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold" style={{ color: GOLD }}>{title}</span>
            {subtitle && <span className="block truncate text-xs text-white/60">{subtitle}</span>}
          </span>
        </Link>
        <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="ml-auto rounded-md p-1.5 hover:bg-white/10 lg:hidden">
          <X size={18} />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {groups.map(([group, list]) => (
          <div key={group} className="mb-3">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">{group}</div>
            {list.map((item) => {
              const Icon = item.icon;
              const on = item.href === active;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm no-underline transition-colors hover:bg-white/10"
                  style={on ? { background: GOLD, color: NAVY, fontWeight: 600 } : { color: "rgba(255,255,255,0.85)" }}
                >
                  <Icon size={17} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        {user && <div className="mb-2 truncate text-xs text-white/60">{user}</div>}
        <div className="flex items-center gap-2">
          <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          <span className="hidden lg:contents">{actions}</span>
          <button type="button" onClick={onSignOut} className="ml-auto flex items-center gap-1.5 rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10">
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r-2 print:hidden lg:block" style={{ borderColor: GOLD }}>
        {panel}
      </aside>

      <header className="sticky top-0 z-40 flex items-center gap-2 border-b-2 px-3 py-2 text-white shadow print:hidden lg:hidden" style={{ background: NAVY, borderColor: GOLD }}>
        <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-white/10">
          <Menu size={20} />
        </button>
        <Link href={homeHref} className="min-w-0 flex-1 truncate text-sm font-bold no-underline" style={{ color: GOLD }}>
          {subtitle ?? title}
        </Link>
        {actions}
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">{panel}</aside>
        </div>
      )}
    </>
  );
}
