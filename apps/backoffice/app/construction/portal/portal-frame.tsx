"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { BackButton, ThemeToggle } from "@zaroda/ui";
import { CON_BRAND, conBackdrop } from "../../../lib/construction";
import { PORTAL_ROLE, type PortalAccount, portalAccount, setPortalAccount } from "../../../lib/con-portal";

/** The portal's own frame: the builder's name, who is signed in, sign out. Phone-first. */
export function PortalFrame({ children }: { children: ReactNode }) {
  const [a, setA] = useState<PortalAccount | null>(null);
  useEffect(() => setA(portalAccount()), [children]);
  return (
    <div className="min-h-screen bg-background text-foreground" style={conBackdrop(0.6)}>
      <header className="sticky top-0 z-40 text-white shadow" style={{ background: CON_BRAND.navy, borderBottom: `3px solid ${CON_BRAND.gold}` }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
          <BackButton homeHref="/construction/portal" />
          <Link href="/construction/portal" className="no-underline">
            <span className="block text-xs font-extrabold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>Project portal</span>
            <span className="block text-sm font-semibold text-white">{a?.organization ?? "Zaroda Build"}</span>
          </Link>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {a && <span className="hidden text-white/80 sm:inline">{a.name} · {PORTAL_ROLE[a.role] ?? a.role}</span>}
            {a && (
              <button type="button" className="rounded-md border border-white/40 px-2 py-1 text-xs" onClick={() => { setPortalAccount(null); window.location.href = "/construction/portal"; }}>
                Sign out
              </button>
            )}
            <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}
