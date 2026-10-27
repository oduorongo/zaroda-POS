"use client";

// ZARODA's own books. The statement, journal and chart screens here are copies of the back office's (apps/backoffice/app/accounting);
// only this file differs between the two apps, so keep those screens the same and put the differences here.
import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
export { downloadCsv } from "../../lib/csv-download";

/** Where ZARODA's books are on the API. */
export const API = "/platform-admin/accounting";

/** ZARODA has no branches. */
export const loadBranches = async (): Promise<{ id: string; name: string }[]> => [];

export function Shell({ session, children }: { session: Session; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      {children}
    </div>
  );
}

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
  ASSET: "What ZARODA has (assets)",
  LIABILITY: "What ZARODA owes (liabilities)",
  EQUITY: "Owners' money (equity)",
  INCOME: "Income",
  EXPENSE: "Costs and expenses",
};

export const kes = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Nairobi is always UTC+3, so "today" is worked out from that, whatever the device's own clock zone is.
export const todayKey = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const monthStart = () => `${todayKey().slice(0, 7)}-01`;
export const niceDay = (day: string | null) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-";

/** The signed-in platform admin, or a redirect to sign in. */
export function useBooksSession(): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);
  return session;
}

/** Every platform admin keeps ZARODA's books. */
export const canWrite = (s: Session) => Boolean(s);

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
