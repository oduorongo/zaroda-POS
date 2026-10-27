"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";

interface Notice {
  id: string;
  noticeNo: number;
  title: string;
  content: string;
  detailUrl: string | null;
  postedBy: string | null;
  postedAt: string | null;
  read: boolean;
}
interface ImportRow {
  id: string;
  taskCd: string;
  declDate: string;
  declNo: string | null;
  hsCd: string | null;
  itemName: string;
  origin: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  supplierName: string | null;
  invoiceAmount: number | null;
  invoiceCurrency: string | null;
  status: "UNSENT" | "WAITING" | "APPROVED" | "CANCELLED";
  product: { id: string; sku: string; name: string } | null;
  remark: string | null;
  lastError: string | null;
}
interface KraBranch {
  bhfId: string;
  name: string;
  active: boolean;
  county: string | null;
  location: string | null;
  manager: string | null;
  headOffice: boolean;
}
interface RegisteredItem {
  variantId: string;
  sku: string;
  name: string;
  itemCd: string | null;
}

type Tab = "notices" | "imports" | "branches" | "customers";
const field = "rounded-md border border-border bg-surface p-2 text-sm";
const kraDate = (s: string | null) => (s && /^\d{14}$/.test(s) ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : s ?? "");
const declDate = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : s);

/** What comes from KRA for this business: notices, items customs declared under its PIN, its branch list, and customers sent to KRA. */
export default function EtimsFromKraPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("notices");
  const [notices, setNotices] = useState<{ unread: number; rows: Notice[] } | null>(null);
  const [imports, setImports] = useState<ImportRow[] | null>(null);
  const [branches, setBranches] = useState<KraBranch[] | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<ImportRow | null>(null);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<RegisteredItem[]>([]);
  const [chosen, setChosen] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const [n, i] = await Promise.all([apiGet<{ unread: number; rows: Notice[] }>("/etims/notices"), apiGet<ImportRow[]>("/etims/imports")]);
      setNotices(n);
      setImports(i);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this.");
    }
  }, []);

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
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  // the registered products to choose from when approving an import
  useEffect(() => {
    if (!approving) return;
    const t = setTimeout(() => {
      void apiGet<{ rows: RegisteredItem[] }>(`/etims/items?state=REGISTERED${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`)
        .then((r) => setItems(r.rows))
        .catch(() => setItems([]));
    }, 250);
    return () => clearTimeout(t);
  }, [approving, search]);

  async function run<T>(fn: () => Promise<T>, done: (v: T) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const v = await fn();
      setNotice(done(v));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">From KRA</h1>
          <Link href="/settings/etims" className="text-sm text-primary-600 hover:underline">Back to eTIMS</Link>
        </div>
        <p className="text-sm text-secondary-500">Notices KRA has put out, items customs declared under your PIN (to approve or cancel), your branches as KRA has them, and your customers with a KRA PIN.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["notices", `Notices${notices && notices.unread > 0 ? ` (${notices.unread})` : ""}`],
              ["imports", `Imported items${imports && imports.some((i) => i.status === "WAITING") ? ` (${imports.filter((i) => i.status === "WAITING").length})` : ""}`],
              ["branches", "Branches at KRA"],
              ["customers", "Customers"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                if (k === "branches" && !branches)
                  void apiGet<KraBranch[]>("/etims/kra-branches")
                    .then(setBranches)
                    .catch((err) => setError(err instanceof ApiError ? err.message : "Could not reach KRA."));
              }}
              className={`rounded-full border px-3 py-1 text-sm ${tab === k ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "notices" && (
          <section className="space-y-2">
            {canEdit && (
              <button disabled={busy} onClick={() => void run(() => apiPost<{ added: number }>("/etims/notices/sync", {}), (r) => (r.added ? `${r.added} new notice(s) from KRA.` : "Nothing new from KRA."))} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary-500/10 disabled:opacity-50">
                Check KRA for notices
              </button>
            )}
            {notices && notices.rows.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No notices yet.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {notices?.rows.map((n) => (
                <li key={n.id} className="p-3">
                  <button
                    className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
                    onClick={() => {
                      setOpenNotice(openNotice === n.id ? null : n.id);
                      if (!n.read) void apiPost(`/etims/notices/${n.id}/read`, {}).then(load).catch(() => undefined);
                    }}
                  >
                    <span className={n.read ? "" : "font-semibold"}>
                      {!n.read && <span className="mr-2 rounded bg-primary-600 px-1.5 py-0.5 text-xs text-white">New</span>}
                      {n.title}
                    </span>
                    <span className="text-xs text-secondary-500">{kraDate(n.postedAt)}</span>
                  </button>
                  {openNotice === n.id && (
                    <div className="mt-2 space-y-1">
                      <p className="whitespace-pre-wrap">{n.content}</p>
                      {n.detailUrl && <a href={n.detailUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">More on the KRA site</a>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "imports" && (
          <section className="space-y-2">
            <p className="text-sm text-secondary-500">Goods customs cleared under your PIN. Approve each as the product it is (the product must already be registered with KRA under eTIMS items), or cancel it if it is not yours. Receive the stock itself as you normally do.</p>
            {canEdit && (
              <button disabled={busy} onClick={() => void run(() => apiPost<{ added: number }>("/etims/imports/sync", {}), (r) => (r.added ? `${r.added} imported item(s) from KRA.` : "Nothing new from KRA."))} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary-500/10 disabled:opacity-50">
                Check KRA for imported items
              </button>
            )}
            {approving && (
              <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
                <p className="font-semibold">Approve {approving.itemName}</p>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your registered products" className={`${field} w-full`} />
                <select value={chosen} onChange={(e) => setChosen(e.target.value)} className={`${field} w-full`}>
                  <option value="">Choose the product...</option>
                  {items.map((i) => <option key={i.variantId} value={i.variantId}>{i.name} ({i.sku}) {i.itemCd}</option>)}
                </select>
                <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Note (optional)" maxLength={400} className={`${field} w-full`} />
                <div className="flex gap-2">
                  <button
                    disabled={busy || !chosen}
                    onClick={() =>
                      void run(async () => {
                        await apiPost(`/etims/imports/${approving.id}/decision`, { decision: "APPROVE", variantId: chosen, remark: remark.trim() || undefined });
                        setApproving(null);
                        return null;
                      }, () => "Approved. KRA has been told.")
                    }
                    className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button onClick={() => setApproving(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
                </div>
              </div>
            )}
            {imports && imports.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No imported items from KRA.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {imports?.map((i) => (
                <li key={i.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{i.itemName}</p>
                      <p className="text-xs text-secondary-500">
                        {i.declNo ?? i.taskCd} · {declDate(i.declDate)} · HS {i.hsCd ?? "-"} · from {i.origin ?? "-"}
                        {i.supplierName ? ` · ${i.supplierName}` : ""}
                      </p>
                      <p className="text-xs text-secondary-500">
                        {i.quantity ?? "-"} {i.quantityUnit ?? ""}
                        {i.invoiceAmount !== null ? ` · ${i.invoiceCurrency ?? ""} ${i.invoiceAmount}` : ""}
                        {i.product ? ` · as ${i.product.name}` : ""}
                      </p>
                      {i.lastError && <p className="text-xs text-red-400">{i.lastError}</p>}
                    </div>
                    <span className="text-xs">
                      {i.status === "WAITING" && <span className="rounded bg-amber-900 px-2 py-0.5 text-amber-200">Waiting</span>}
                      {i.status === "APPROVED" && <span className="rounded bg-green-900 px-2 py-0.5 text-green-200">Approved</span>}
                      {i.status === "CANCELLED" && <span className="rounded bg-secondary-500/20 px-2 py-0.5">Cancelled</span>}
                      {i.status === "UNSENT" && <span className="rounded bg-secondary-500/20 px-2 py-0.5">Unsent</span>}
                    </span>
                  </div>
                  {canEdit && (i.status === "WAITING" || i.status === "UNSENT") && (
                    <p className="flex gap-3 text-xs">
                      <button onClick={() => { setApproving(i); setChosen(""); setRemark(""); setSearch(""); }} className="text-primary-600 hover:underline">Approve as a product</button>
                      <button
                        onClick={() => {
                          const why = window.prompt("Why is it being cancelled? (optional)");
                          if (why === null) return;
                          void run(() => apiPost(`/etims/imports/${i.id}/decision`, { decision: "CANCEL", remark: why.trim() || undefined }), () => "Cancelled. KRA has been told.");
                        }}
                        className="text-red-400 hover:underline"
                      >
                        Cancel
                      </button>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "branches" && (
          <section className="space-y-2">
            <p className="text-sm text-secondary-500">Your branches as KRA has them. Use the branch ID shown here when connecting a branch.</p>
            {!branches && <p className="text-sm text-secondary-500">Asking KRA...</p>}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {branches?.map((b) => (
                <li key={b.bhfId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="font-mono font-semibold">{b.bhfId}</span> {b.name}
                    {b.headOffice && <span className="ml-2 rounded bg-secondary-500/20 px-1.5 py-0.5 text-xs">Head office</span>}
                  </span>
                  <span className="text-xs text-secondary-500">{[b.county, b.location, b.manager].filter(Boolean).join(" · ")}{b.active ? "" : " · not active"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "customers" && (
          <section className="space-y-2 text-sm">
            <p className="text-secondary-500">Customers that have a KRA PIN (set on the Customers screen) are sent to KRA automatically about once a minute, and again when their name or PIN changes. You can send them now.</p>
            {canEdit && (
              <button disabled={busy} onClick={() => void run(() => apiPost<{ sent: number; failed: number }>("/etims/customers/sync", {}), (r) => `${r.sent} customer(s) sent${r.failed ? `, ${r.failed} could not be sent (will be tried again)` : ""}.`)} className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary-500/10 disabled:opacity-50">
                Send customers to KRA now
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
