"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet } from "../../lib/api";
import { clearSession } from "../../lib/auth";
import { CON_BRAND, isDirector, useConSession, type ConMe } from "../../lib/construction";
import { useIdleLogout } from "../../hooks/use-idle-logout";

const MeContext = createContext<ConMe | null>(null);
export const useConMe = () => useContext(MeContext);

const LINKS = [
  { href: "/construction", label: "Home" },
  { href: "/construction/compliance", label: "Compliance" },
  { href: "/construction/plan", label: "Plan" },
  { href: "/construction/settings", label: "Settings" },
];
const CORE_LINKS = [
  { href: "/suppliers", label: "Suppliers" },
  { href: "/products", label: "Materials" },
];

/** Every signed-in construction screen: navy bar (scrolls sideways on a phone), plan banner, then the page. */
export function ConShell({ title, children }: { title: string; children: ReactNode }) {
  const session = useConSession();
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<ConMe | null>(null);
  useIdleLogout();

  useEffect(() => {
    if (session) apiGet<ConMe>("/construction/me").then(setMe).catch(() => undefined);
  }, [session]);

  if (!session) return <div className="flex min-h-screen items-center justify-center text-sm text-secondary-500">Loading...</div>;
  const links = [...LINKS, ...(isDirector(me) ? [{ href: "/construction/staff", label: "Staff & roles" }] : []), ...(["OWNER", "MANAGER"].includes(session.role) ? CORE_LINKS : [])];

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-40 text-white shadow" style={{ background: CON_BRAND.navy }}>
          <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-5">
            <Link href="/construction" className="flex min-w-0 items-center gap-2 no-underline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/zaroda-logo-white.png" alt="Zaroda" className="h-8 w-auto" />
              <span className="truncate text-sm font-bold" style={{ color: CON_BRAND.gold }}>
                {session.orgName ?? "Zaroda Build"}
              </span>
            </Link>
            <button
              type="button"
              className="shrink-0 rounded-md border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10"
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
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
        <PlanBanner me={me} />
        <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
          <h1 className="text-xl font-bold" style={{ color: CON_BRAND.navy }}>
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
