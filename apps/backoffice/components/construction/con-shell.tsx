"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@zaroda/ui";
import { apiGet } from "../../lib/api";
import { clearSession, type Session } from "../../lib/auth";
import { CON_BRAND, hasConRole, useConSession, type ConMe } from "../../lib/construction";
import { useIdleLogout } from "../../hooks/use-idle-logout";

const MeContext = createContext<ConMe | null>(null);
export const useConMe = () => useContext(MeContext);

const LINKS = [
  { href: "/construction", label: "Home" },
  { href: "/construction/projects", label: "Projects" },
  { href: "/construction/site", label: "Site" },
  { href: "/construction/workers", label: "Workers" },
  { href: "/construction/plant", label: "Plant" },
  { href: "/construction/tenders", label: "Tenders" },
  { href: "/construction/compliance", label: "Compliance" },
  { href: "/construction/plan", label: "Plan" },
  { href: "/construction/settings", label: "Settings" },
];
const CORE_LINKS = [
  { href: "/suppliers", label: "Suppliers" },
  { href: "/construction/materials", label: "Materials" },
];

/**
 * The construction top bar (navy, scrolls sideways on a phone). Also shown on the shared back-office screens a contractor
 * uses (Suppliers, Staff) via components/nav.tsx, so they never look like they left Zaroda Build.
 */
export function ConHeader({ session, me }: { session: Session; me: ConMe | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const links = [...LINKS, ...(hasConRole(me, "CON_COMPLIANCE") ? [{ href: "/construction/staff", label: "Staff & roles" }] : []), ...(["OWNER", "MANAGER"].includes(session.role) ? CORE_LINKS : [])];

  return (
    <header className="sticky top-0 z-40 text-white shadow" style={{ background: CON_BRAND.navy }}>
      <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-5">
        <Link href="/construction" className="flex min-w-0 items-center gap-2 no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zaroda-logo-white.png" alt="Zaroda" className="h-8 w-auto" />
          <span className="truncate text-sm font-bold" style={{ color: CON_BRAND.gold }}>
            {session.orgName ?? "Zaroda Build"}
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          <button
            type="button"
            className="rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10"
            onClick={() => {
              clearSession();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 text-sm sm:px-4">
        {links.map((l) => {
          const active = l.href === "/construction" ? pathname === l.href : !!pathname?.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 no-underline"
              style={active ? { background: CON_BRAND.gold, color: CON_BRAND.navy, fontWeight: 600 } : { color: "rgba(255,255,255,0.85)" }}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/** The signed-in contractor's roles and plan, for the bar and the screens. */
export function useConMeFetch(session: Session | null) {
  const [me, setMe] = useState<ConMe | null>(null);
  useEffect(() => {
    if (session?.industryType === "CONSTRUCTION") apiGet<ConMe>("/construction/me").then(setMe).catch(() => undefined);
  }, [session]);
  return me;
}

/** Every signed-in construction screen: top bar, plan banner, then the page. */
export function ConShell({ title, children }: { title: string; children: ReactNode }) {
  const session = useConSession();
  const me = useConMeFetch(session);
  useIdleLogout();

  if (!session) return <div className="flex min-h-screen items-center justify-center text-sm text-secondary-500">Loading...</div>;

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen bg-background text-foreground">
        <ConHeader session={session} me={me} />
        <PlanBanner me={me} />
        <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
          <h1 className="text-xl font-bold" style={{ color: "var(--con-ink)" }}>
            {title}
          </h1>
          {children}
        </main>
      </div>
    </MeContext.Provider>
  );
}

function PlanBanner({ me }: { me: ConMe | null }) {
  if (!me || me.status === "ACTIVE" || me.status === "TRIAL") return null;
  const lapsed = me.status === "SUSPENDED" || me.status === "CANCELLED";
  return (
    <div className="px-4 py-2 text-center text-sm font-medium text-white" style={{ background: lapsed ? "#b91c1c" : CON_BRAND.orange }}>
      {lapsed ? "Your plan has lapsed: the account is read-only (nothing is deleted). " : "Your plan payment is overdue - pay soon to avoid read-only mode. "}
      <Link href="/construction/plan" className="underline">
        Pay now
      </Link>
    </div>
  );
}
