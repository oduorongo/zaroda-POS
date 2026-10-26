"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPut, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

type State = "NEW" | "SEEN" | "SAVED" | "DISMISSED";
interface Advert {
  id: string;
  reference: string | null;
  title: string;
  description: string;
  county: string;
  items: { description: string; quantity: number | null; unit: string | null }[];
  documentsInfo: string | null;
  pdfUrl: string | null;
  pdfName: string | null;
  closingDate: string;
  daysLeft: number;
  open: boolean;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  school: { name: string; county: string };
  postedAt: string;
  state: State;
}
interface Board {
  rows: Advert[];
  counts: { new: number; saved: number };
}

const SHOW: [string, string][] = [
  ["", "All"],
  ["NEW", "New"],
  ["SAVED", "Saved"],
  ["SEEN", "Seen"],
  ["DISMISSED", "Dismissed"],
];
const field = "rounded-md border border-border bg-surface p-2 text-sm";
const phoneShow = (p: string) => p.replace(/^254/, "0");

/** Tender adverts posted by schools: new ones first to look at, saved ones to come back to, and who to contact. */
export default function SchoolTenderAdvertsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Board | null>(null);
  const [show, setShow] = useState("");
  const [q, setQ] = useState("");
  const [county, setCounty] = useState("");
  const [closed, setClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (show) p.set("show", show);
      if (q.trim()) p.set("q", q.trim());
      if (county.trim()) p.set("county", county.trim());
      if (closed) p.set("closed", "true");
      setData(await apiGet<Board>(`/school-supplier/tender-adverts?${p.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the adverts.");
    }
  }, [show, q, county, closed]);

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
    if (!session) return;
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [session, load]);

  async function mark(a: Advert, state: "SEEN" | "SAVED" | "DISMISSED") {
    try {
      await apiPut(`/school-supplier/tender-adverts/${a.id}/state`, { state });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that.");
    }
  }

  function toggle(a: Advert) {
    if (openId === a.id) {
      setOpenId(null);
      return;
    }
    setOpenId(a.id);
    if (canEdit && a.state === "NEW") void apiPut(`/school-supplier/tender-adverts/${a.id}/state`, { state: "SEEN" }).then(load).catch(() => undefined);
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Tender adverts from schools</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/school-tenders" className="text-primary-600 hover:underline">My tenders</Link>
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">Schools post what they want to buy, and you get an email when a new one is posted. Open one to see what is wanted, the closing date and who to contact. To bid, contact the school and add it under &quot;My tenders&quot; to prepare your bid. Schools are checked by Zaroda before they can post, but always check a tender is genuine before you spend money on a bid.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {SHOW.map(([key, label]) => (
            <button key={label} onClick={() => setShow(key)} className={`rounded-full border px-3 py-1 text-sm ${show === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
              {label}
              {key === "NEW" && data && data.counts.new > 0 ? ` (${data.counts.new})` : ""}
              {key === "SAVED" && data && data.counts.saved > 0 ? ` (${data.counts.saved})` : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (stationery, desks, a school...)" className={`${field} w-64`} />
          <input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="County" className={`${field} w-40`} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Include ones that closed recently</label>
        </div>

        {data && data.rows.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No adverts to show.</p>}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data?.rows.map((a) => (
            <li key={a.id} className="p-3 text-sm">
              <div className="flex cursor-pointer flex-wrap items-start justify-between gap-2" onClick={() => toggle(a)}>
                <div>
                  <p className="font-semibold">
                    {a.state === "NEW" && <span className="mr-2 rounded bg-primary-600 px-1.5 py-0.5 text-xs text-white">New</span>}
                    {a.state === "SAVED" && <span className="mr-2 rounded bg-amber-900 px-1.5 py-0.5 text-xs text-amber-200">Saved</span>}
                    {a.title}
                  </p>
                  <p className="text-xs text-secondary-500">{a.school.name} · {a.county}{a.reference ? ` · ${a.reference}` : ""}</p>
                </div>
                <p className={`text-xs ${a.open && a.daysLeft <= 3 ? "text-red-400" : "text-secondary-500"}`}>
                  {a.open ? (a.daysLeft === 0 ? "Closes today" : `Closes ${a.closingDate} (${a.daysLeft} days)`) : `Closed ${a.closingDate}`}
                </p>
              </div>
              {openId === a.id && (
                <div className="mt-3 space-y-3 rounded-md bg-secondary-500/5 p-3">
                  <p className="whitespace-pre-wrap">{a.description}</p>
                  {a.items.length > 0 && (
                    <table className="w-full text-xs">
                      <thead className="text-left text-secondary-500"><tr><th className="py-1">Item</th><th className="py-1 text-right">Quantity</th></tr></thead>
                      <tbody>
                        {a.items.map((i, n) => (
                          <tr key={n} className="border-t border-border/60">
                            <td className="py-1">{i.description}</td>
                            <td className="py-1 text-right">{i.quantity ?? ""} {i.unit ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {a.pdfUrl && (
                    <p>
                      <a href={a.pdfUrl} target="_blank" rel="noreferrer" className="rounded-md bg-primary-600 px-3 py-1.5 font-semibold text-white hover:bg-primary-700">Open the tender document (PDF)</a>
                      <span className="ml-2 text-xs text-secondary-500">{a.pdfName}</span>
                    </p>
                  )}
                  {a.documentsInfo && <p><span className="text-secondary-500">Tender documents: </span>{a.documentsInfo}</p>}
                  <p>
                    <span className="text-secondary-500">Contact: </span>{a.contactName} ·{" "}
                    <a href={`tel:+${a.contactPhone}`} className="text-primary-600 hover:underline">{phoneShow(a.contactPhone)}</a>
                    {a.contactEmail && <> · <a href={`mailto:${a.contactEmail}`} className="text-primary-600 hover:underline">{a.contactEmail}</a></>}
                  </p>
                  {canEdit && (
                    <p className="flex gap-3 text-xs">
                      {a.state !== "SAVED" && <button onClick={() => void mark(a, "SAVED")} className="text-primary-600 hover:underline">Save for later</button>}
                      {a.state === "SAVED" && <button onClick={() => void mark(a, "SEEN")} className="text-primary-600 hover:underline">Remove from saved</button>}
                      {a.state !== "DISMISSED" && <button onClick={() => void mark(a, "DISMISSED")} className="text-primary-600 hover:underline">Not for us</button>}
                      {a.state === "DISMISSED" && <button onClick={() => void mark(a, "SEEN")} className="text-primary-600 hover:underline">Bring it back</button>}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
