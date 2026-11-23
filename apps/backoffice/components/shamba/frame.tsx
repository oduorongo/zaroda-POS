"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearSession, getSession, type Session } from "../../lib/auth";
import { SHAMBA_BRAND } from "../../lib/shamba";
import { menuFor } from "../../lib/menu";
import { useIdleLogout } from "../../hooks/use-idle-logout";
import { SideNav } from "../side-nav";

const FOOTNOTE = "Powered by ZARODA SOLUTIONS - Innovative. Reliable. Forward. - WhatsApp 0781230805 - Call 0724282065";

function Brand() {
  return (
    <span className="flex items-center gap-2 font-bold text-white">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm" style={{ background: SHAMBA_BRAND.gold, color: SHAMBA_BRAND.navy }}>
        ZS
      </span>
      Zaroda Shamba
    </span>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t-[3px] px-4 py-4 text-center text-xs text-white/80" style={{ background: SHAMBA_BRAND.navy, borderColor: SHAMBA_BRAND.gold }}>
      {FOOTNOTE}
    </footer>
  );
}

/** The welcome, pricing, sign-in and sign-up pages. */
export function ShambaPublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-secondary-50 text-secondary-900">
      <header className="border-b-[3px]" style={{ background: SHAMBA_BRAND.navy, borderColor: SHAMBA_BRAND.gold }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/shamba/welcome">
            <Brand />
          </Link>
          <nav className="flex items-center gap-4 text-sm text-white">
            <Link href="/shamba/pricing" className="hover:underline">
              Pricing
            </Link>
            <Link href="/shamba/guide" className="hover:underline">
              Guide
            </Link>
            <a href="/login" className="hover:underline">
              Sign in
            </a>
            <Link href="/shamba/signup" className="rounded-lg px-3 py-1.5 font-semibold" style={{ background: SHAMBA_BRAND.orange }}>
              Start free
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <Footer />
    </div>
  );
}

/** Signed-in farm screens: a farm session only; anyone else is sent to sign in. */
export function ShambaAppFrame({ children }: { children: (session: Session) => ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  useIdleLogout();

  useEffect(() => {
    const s = getSession();
    if (!s || s.industryType !== "FARM") {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);

  if (!session) return null;
  return (
    <div className="flex min-h-screen flex-col bg-secondary-50 text-secondary-900">
      <SideNav
        title="ZARODA SHAMBA"
        subtitle={session.orgName ?? "Zaroda Shamba"}
        homeHref="/shamba"
        items={menuFor(session)}
        user={session.email}
        onSignOut={() => {
          clearSession();
          router.replace("/login");
        }}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children(session)}</main>
      <Footer />
    </div>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
