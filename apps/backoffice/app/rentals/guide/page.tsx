"use client";

import { useEffect, useState } from "react";
import { RentalsFrame } from "../../../components/rentals/public-frame";
import { GuideMarkdown, slug } from "../../../components/construction/guide-markdown";
import { RENTALS_BRAND } from "../../../lib/rentals";

/** The ZARODA RENTALS user guide (public/guides/rentals.md), open to everyone: landlords, caretakers and tenants. */
export default function RentalsGuide() {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/guides/rentals.md")
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setSource)
      .catch(() => setFailed(true));
  }, []);

  const sections = source ? (source.match(/^## .+$/gm) ?? []).map((m) => m.slice(3).trim()) : [];
  return (
    <RentalsFrame>
      <div className="px-3 py-8 sm:px-6 sm:py-12" style={{ background: `linear-gradient(180deg, ${RENTALS_BRAND.navy} 0, ${RENTALS_BRAND.navy} 220px, transparent 220px)` }}>
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: RENTALS_BRAND.gold }}>{RENTALS_BRAND.name}</p>
          <h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">User guide</h1>
          <p className="mt-2 max-w-xl text-white/85">Setting up, collecting rent, M-Pesa, reminders, repairs, caretakers, adverts, your books and the tenant portal.</p>
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
    </RentalsFrame>
  );
}
