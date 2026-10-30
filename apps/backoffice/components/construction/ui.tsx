"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CON_BRAND } from "../../lib/construction";

export type ExpiryState = "OK" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY";

const BADGE: Record<ExpiryState, { bg: string; fg: string; label: string }> = {
  OK: { bg: "#dcfce7", fg: "#166534", label: "Valid" },
  EXPIRING: { bg: "#fef3c7", fg: "#92400e", label: "Expiring" },
  EXPIRED: { bg: "#fee2e2", fg: "#991b1b", label: "Expired" },
  NO_EXPIRY: { bg: "#e5e7eb", fg: "#374151", label: "No expiry" },
};

export function ExpiryBadge({ state, daysLeft }: { state: ExpiryState; daysLeft?: number | null }) {
  const b = BADGE[state];
  const extra = daysLeft === null || daysLeft === undefined ? "" : daysLeft < 0 ? ` ${-daysLeft}d ago` : ` ${daysLeft}d`;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: b.bg, color: b.fg }}>
      {b.label}
      {state !== "NO_EXPIRY" && extra}
    </span>
  );
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold" style={{ color: CON_BRAND.navy }}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>;
}

/** Shown in place of a feature the plan does not include (API answered 402) - never a silent failure. */
export function UpgradeCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border-2 p-4" style={{ borderColor: CON_BRAND.gold, background: "#fffbeb" }}>
      <p className="font-semibold" style={{ color: CON_BRAND.navy }}>Upgrade to use this</p>
      <p className="mt-1 text-sm text-secondary-700">{message}</p>
      <Link href="/construction/plan" className="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white no-underline" style={{ background: CON_BRAND.orange }}>
        See plans
      </Link>
    </div>
  );
}

export const inputClass = "w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#d4af37]";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-secondary-600">{label}</span>
      {children}
    </label>
  );
}

export function PrimaryButton({ children, disabled, onClick, type = "button" }: { children: ReactNode; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: CON_BRAND.navy }}>
      {children}
    </button>
  );
}
