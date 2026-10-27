"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  systemKey: string | null;
  description: string | null;
  active: boolean;
  balance: number;
  system: boolean;
}

export const TYPE_LABELS: Record<Account["type"], string> = {
  ASSET: "What you have (assets)",
  LIABILITY: "What you owe (liabilities)",
  EQUITY: "Owner's money (equity)",
  INCOME: "Income",
  EXPENSE: "Costs and expenses",
};

export const kes = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Nairobi is always UTC+3, so "today" is worked out from that, whatever the device's own clock zone is.
export const todayKey = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const monthStart = () => `${todayKey().slice(0, 7)}-01`;
export const niceDay = (day: string | null) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-";

/** The signed-in back-office user, or a redirect to sign in. */
export function useBackofficeSession(): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);
  return session;
}

export const canWrite = (s: Session) => s.role === "OWNER" || s.role === "MANAGER";

const TABS = [
  ["/accounting", "Overview"],
  ["/accounting/reports", "Statements"],
  ["/accounting/journals", "Journals"],
  ["/accounting/accounts", "Chart of accounts"],
] as const;

export function AccountingTabs() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map(([href, label]) => {
        const active = href === "/accounting" ? pathname === href : !!pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-full border px-3 py-1.5 text-sm ${active ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export const inputClass = "mt-1 block w-full rounded-md border border-border bg-surface p-2 text-sm";
export const buttonClass = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
export const quietButtonClass = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
