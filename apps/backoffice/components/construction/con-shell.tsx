"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bell } from "lucide-react";
import { apiGet } from "../../lib/api";
import { clearSession, type Session } from "../../lib/auth";
import { CON_BRAND, useConSession, type ConMe, conBackdropCss } from "../../lib/construction";
import { menuFor } from "../../lib/menu";
import { SideNav } from "../side-nav";
import { useIdleLogout } from "../../hooks/use-idle-logout";

const MeContext = createContext<ConMe | null>(null);
export const useConMe = () => useContext(MeContext);

/**
 * The construction menu: the shared left sidebar (components/side-nav.tsx) with the screens this person may open. Also shown on
 * the shared back-office screens a contractor uses (Suppliers, Staff) via components/nav.tsx, so they never look like they left Zaroda Build.
 */
export function ConHeader({ session, me }: { session: Session; me: ConMe | null }) {
  const router = useRouter();
  return (
    <>
      <style>{conBackdropCss(0.62)}</style>
      <SideNav
        title="ZARODA BUILD"
        subtitle={session.orgName ?? "Zaroda Build"}
        homeHref="/construction"
        items={menuFor(session, me)}
        user={session.email}
        actions={<MessagesBell />}
        onSignOut={() => {
          clearSession();
          router.replace("/login");
        }}
      />
    </>
  );
}

/** The bell: unread messages, checked every minute and when the tab comes back into view. */
function MessagesBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const check = () => apiGet<{ unread: number }>("/construction/messages/unread").then((r) => setUnread(r.unread)).catch(() => undefined);
    void check();
    const every = setInterval(check, 60_000);
    const onShow = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("con-messages-read", check);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("con-messages-read", check);
    };
  }, [pathname]);
  return (
    <Link href="/construction/messages" title={unread ? `${unread} unread message${unread === 1 ? "" : "s"}` : "Messages"} className="relative rounded-md p-1.5 text-white no-underline hover:bg-white/10">
      <Bell size={18} />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold leading-[1.1rem]" style={{ background: CON_BRAND.orange, color: "white" }}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
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
