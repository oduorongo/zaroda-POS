"use client";

import Link from "next/link";
import { CON_BRAND } from "../../../lib/construction";
import { PublicFrame } from "../../../components/construction/public-frame";

const POINTS = [
  { title: "Compliance vault", text: "NCA, KRA TCC, WIBA and permits in one place, with alerts 60, 30 and 7 days before anything expires." },
  { title: "Projects and BQ", text: "Contract sums, bills of quantities, site diaries and photos from the site supervisor's phone." },
  { title: "Labour and payroll", text: "Muster roll, casual payroll with statutory deductions, and M-Pesa payouts." },
  { title: "Valuations and IPCs", text: "Interim certificates, retention and variations, invoiced through eTIMS." },
];

export default function ConstructionWelcome() {
  return (
    <PublicFrame>
      <section className="text-white" style={{ background: `linear-gradient(160deg, ${CON_BRAND.navy}, #0f1c3a)` }}>
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: CON_BRAND.gold }}>For Kenyan contractors</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">Run your sites, your compliance and your certificates from one place.</h1>
          <p className="mt-4 max-w-xl text-white/80">Built around NCA categories, KRA eTIMS and the way JBC and FIDIC contracts are paid.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/construction/signup" className="rounded-lg px-5 py-3 font-semibold text-white no-underline" style={{ background: CON_BRAND.orange }}>Start the 14-day free trial</Link>
            <Link href="/construction/pricing" className="rounded-lg border border-white/40 px-5 py-3 font-semibold text-white no-underline">See pricing</Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-10 sm:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-bold" style={{ color: "var(--con-ink)" }}>{p.title}</h2>
            <p className="mt-1 text-sm text-secondary-600">{p.text}</p>
          </div>
        ))}
      </section>
    </PublicFrame>
  );
}
