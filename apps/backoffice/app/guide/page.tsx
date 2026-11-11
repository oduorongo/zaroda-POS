"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RibbonLink, ThemeToggle, TopRibbon } from "@zaroda/ui";
import { GuideMarkdown, slug } from "../../components/construction/guide-markdown";
import { getSession } from "../../lib/auth";

// Business types with their own guide section (public/guides/pos-<type>.md), shown after Getting started.
const BUSINESS_GUIDES: Record<string, string> = {
  SCHOOL_SUPPLIER: "School supplier",
  HOTEL: "Hotel",
  RESTAURANT: "Restaurant",
  PHARMACY: "Pharmacy",
  SALON: "Salon",
  MANUFACTURING: "Production",
  SERVICE: "Service business",
};

const fetchText = (path: string) => fetch(path).then((r) => (r.ok ? r.text() : Promise.reject()));

/** The Zaroda POS user guide (public/guides/pos.md), open to everyone, with the section for the reader's kind of business. */
export default function PosGuide() {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [business, setBusiness] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    setSignedIn(!!session);
    const asked = new URLSearchParams(window.location.search).get("for")?.toUpperCase();
    const type = [asked, session?.industryType].find((t) => t && BUSINESS_GUIDES[t]) ?? null;
    setBusiness(type);
    Promise.all([fetchText("/guides/pos.md"), type ? fetchText(`/guides/pos-${type.toLowerCase()}.md`).catch(() => "") : ""])
      .then(([main, extra]) => {
        const at = main.indexOf("\n## Products and categories");
        setSource(extra && at > 0 ? `${main.slice(0, at)}\n${extra.trim()}\n\n---\n${main.slice(at)}` : main);
      })
      .catch(() => setFailed(true));
  }, []);

  const sections = source ? (source.match(/^## .+$/gm) ?? []).map((m) => m.slice(3).trim()) : [];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopRibbon appName="Zaroda POS" homeHref={signedIn ? "/dashboard" : "/login"} LinkComponent={Link}>
        <RibbonLink href={signedIn ? "/dashboard" : "/login"} LinkComponent={Link}>{signedIn ? "Back office" : "Sign in"}</RibbonLink>
        <ThemeToggle />
      </TopRibbon>
      <div className="px-3 py-8 sm:px-6 sm:py-12" style={{ background: "linear-gradient(180deg, #0f1f45 0, #0f1f45 220px, transparent 220px)" }}>
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#d4af37]">Zaroda POS</p>
          <h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">User guide{business ? `: ${BUSINESS_GUIDES[business]}` : ""}</h1>
          <p className="mt-2 max-w-xl text-white/85">
            {business ? `How Zaroda works for a ${BUSINESS_GUIDES[business].toLowerCase()}, then ` : ""}setting up, the till, stock, suppliers, staff, reports, the books, KRA eTIMS and the online shop.
          </p>
          <article className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-xl sm:p-10">
            {failed && <p className="text-sm text-red-700">The guide could not be loaded. Refresh to try again.</p>}
            {!source && !failed && <p className="text-sm text-secondary-500">Loading...</p>}
            {sections.length > 0 && (
              <nav className="mb-4 flex flex-wrap gap-2 text-xs">
                {sections.map((s) => (
                  <a key={s} href={`#${slug(s)}`} className="rounded-full border border-border px-3 py-1 no-underline hover:bg-secondary-500/10" style={{ color: "var(--con-ink)" }}>
                    {s}
                  </a>
                ))}
              </nav>
            )}
            {source && <GuideMarkdown source={source} />}
          </article>
        </div>
      </div>
    </div>
  );
}
