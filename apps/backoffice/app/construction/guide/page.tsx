"use client";

import { useEffect, useState } from "react";
import { PublicFrame } from "../../../components/construction/public-frame";
import { GuideMarkdown, slug } from "../../../components/construction/guide-markdown";
import { CON_BRAND } from "../../../lib/construction";

/** The user guide (public/guides/construction.md), open to everyone, over the site photo in public/con-guide.jpg. */
export default function ConstructionGuide() {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/guides/construction.md")
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setSource)
      .catch(() => setFailed(true));
  }, []);

  const sections = source ? (source.match(/^## .+$/gm) ?? []).map((m) => m.slice(3).trim()) : [];
  return (
    <PublicFrame>
      <div className="min-h-screen bg-cover bg-fixed bg-center px-3 py-8 sm:px-6 sm:py-12" style={{ backgroundImage: "url(/con-guide.jpg)", backgroundColor: CON_BRAND.navy }}>
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>Zaroda Build</p>
          <h1 className="mt-1 text-3xl font-bold text-white drop-shadow sm:text-4xl">User guide</h1>
          <p className="mt-2 max-w-xl text-white/85">What each job does in Zaroda Build, the company books, the reports and the portal.</p>
          <article className="mt-6 rounded-2xl bg-surface/95 p-5 shadow-xl backdrop-blur sm:p-10">
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
    </PublicFrame>
  );
}
