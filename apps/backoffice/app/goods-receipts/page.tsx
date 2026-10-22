"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Receipt {
  id: string;
  receiptNumber: string;
  createdAt: string;
  deliveryNote: string | null;
  branch: { name: string };
  supplier: { name: string } | null;
  purchaseOrder: { id: string; reference: string | null } | null;
  bills: { id: string; billNumber: string; total: number; status: string }[];
  lines: { id: string; quantityAccepted: number; quantityDamaged: number; value: number | null }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every delivery received into stock, newest first: the goods-received notes. */
export default function GoodsReceiptsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSession(s);
    apiGet<Receipt[]>("/goods-receipts").then(setRows).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the receipts."));
  }, [router]);

  if (!session) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Goods received</h1>
          <div className="flex gap-2">
            <Link href="/inventory/receive" className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Receive stock</Link>
            <Link href="/supplier-bills" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10">Supplier bills</Link>
          </div>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {rows && rows.length === 0 && <p className="text-sm text-secondary-500">Nothing received yet.</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-secondary-500">
                <tr>
                  <th className="p-3">Note</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3 text-right">Received</th>
                  <th className="p-3 text-right">Damaged</th>
                  <th className="p-3 text-right">Value</th>
                  <th className="p-3">Bill</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const value = r.lines.every((l) => l.value !== null) ? r.lines.reduce((s, l) => s + (l.value ?? 0), 0) : null;
                  const damaged = r.lines.reduce((s, l) => s + l.quantityDamaged, 0);
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-3">
                        <Link href={`/goods-receipts/${r.id}`} className="font-mono text-primary-400 hover:underline">{r.receiptNumber}</Link>
                        {r.deliveryNote && <span className="block text-xs text-secondary-500">{r.deliveryNote}</span>}
                      </td>
                      <td className="p-3">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="p-3">{r.branch.name}</td>
                      <td className="p-3">{r.supplier?.name ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{r.lines.reduce((s, l) => s + l.quantityAccepted, 0)}</td>
                      <td className={`p-3 text-right font-mono ${damaged > 0 ? "text-amber-500" : ""}`}>{damaged || ""}</td>
                      <td className="p-3 text-right font-mono">{value === null ? "—" : kes(value)}</td>
                      <td className="p-3">{r.bills[0] ? `${r.bills[0].billNumber} (${r.bills[0].status.replace("_", " ").toLowerCase()})` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
