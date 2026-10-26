"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPatch, apiPost, apiPut, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface School {
  id: string;
  name: string;
  contactName: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  county: string | null;
  creditLimit: number | null;
  creditDays: number;
  retentionPercent: number;
  retentionReleaseDays: number;
  status: "ACTIVE" | "SUSPENDED";
  lastLoginAt: string | null;
  notes: string | null;
  owed: number;
  overdue: number;
  credit: number;
  openInvoices: number;
}
interface Portal {
  slug: string;
  displayName: string;
  enabled: boolean;
}
interface Org {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  invoiceFooter: string | null;
}
interface PinNotice {
  school: string;
  phone: string;
  pin: string;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const STOREFRONT = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://shop.zarodashop.com";

/** The schools a supplier sells to on credit, the link they order from, and the PIN each one signs in with. */
export default function SchoolsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [schools, setSchools] = useState<School[] | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinNotice, setPinNotice] = useState<PinNotice | null>(null);
  const [busy, setBusy] = useState(false);

  // Add / edit a school
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [creditDays, setCreditDays] = useState("30");
  const [retentionPercent, setRetentionPercent] = useState("0");
  const [retentionReleaseDays, setRetentionReleaseDays] = useState("0");

  // Portal address and business details
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bizAddress, setBizAddress] = useState("");
  const [bizPhone, setBizPhone] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizFooter, setBizFooter] = useState("");

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const [list, p, o] = await Promise.all([apiGet<School[]>("/school-supplier/schools"), apiGet<Portal | null>("/school-supplier/portal"), apiGet<Org>("/organizations/me")]);
      setSchools(list);
      setPortal(p);
      setOrg(o);
      setSlug((cur) => cur || p?.slug || "");
      setDisplayName((cur) => cur || p?.displayName || o.name || "");
      setBizAddress(o.address ?? "");
      setBizPhone(o.phone ?? "");
      setBizEmail(o.email ?? "");
      setBizFooter(o.invoiceFooter ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your schools.");
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
    setSessionState(s);
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  function reset() {
    setEditingId(null);
    setName("");
    setContactName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setCreditLimit("");
    setCreditDays("30");
    setRetentionPercent("0");
    setRetentionReleaseDays("0");
  }

  function startEdit(s: School) {
    setEditingId(s.id);
    setName(s.name);
    setContactName(s.contactName ?? "");
    setPhone(s.phone.replace(/^254/, "0"));
    setEmail(s.email ?? "");
    setAddress(s.address ?? "");
    setCreditLimit(s.creditLimit === null ? "" : String(s.creditLimit));
    setCreditDays(String(s.creditDays));
    setRetentionPercent(String(s.retentionPercent));
    setRetentionReleaseDays(String(s.retentionReleaseDays));
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSchool(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        name: name.trim(),
        contactName: contactName.trim() || undefined,
        phone: phone.trim(),
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        creditLimit: creditLimit === "" ? (editingId ? null : undefined) : Number(creditLimit),
        creditDays: Number(creditDays || 30),
        retentionPercent: Number(retentionPercent || 0),
        retentionReleaseDays: Number(retentionReleaseDays || 0),
      };
      if (editingId) {
        await apiPatch(`/school-supplier/schools/${editingId}`, body);
        setNotice("School updated.");
      } else {
        const created = await apiPost<{ temporaryPin: string }>("/school-supplier/schools", body);
        setPinNotice({ school: body.name, phone: body.phone, pin: created.temporaryPin });
      }
      reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that school.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(s: School) {
    if (!window.confirm(`Give ${s.name} a new PIN? Their old PIN will stop working.`)) return;
    setError(null);
    try {
      const r = await apiPost<{ temporaryPin: string }>(`/school-supplier/schools/${s.id}/reset-pin`, {});
      setPinNotice({ school: s.name, phone: s.phone.replace(/^254/, "0"), pin: r.temporaryPin });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make a new PIN.");
    }
  }

  async function toggle(s: School) {
    const next = s.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    if (next === "SUSPENDED" && !window.confirm(`Stop ${s.name} from ordering? They will be signed out.`)) return;
    try {
      await apiPatch(`/school-supplier/schools/${s.id}`, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change that.");
    }
  }

  async function savePortal(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut("/school-supplier/portal", { slug: slug.trim().toLowerCase(), displayName: displayName.trim(), enabled: portal?.enabled ?? true });
      setNotice("Ordering link saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the link.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBusiness(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPatch("/organizations/me", { address: bizAddress, phone: bizPhone, email: bizEmail, invoiceFooter: bizFooter });
      setNotice("Business details saved. They now print on your invoices, delivery notes and receipts.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const link = portal ? `${STOREFRONT.replace(/\/+$/, "")}/schools/${portal.slug}` : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Schools</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
            <Link href="/school-money" className="text-primary-600 hover:underline">Invoices &amp; payments</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">
          Add each school you sell to. Give the contact person the ordering link, their phone number and the PIN we make for them. They sign in, see your price list, and send you orders.
        </p>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        {pinNotice && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-950/40 p-4 text-sm">
            <p className="font-semibold text-amber-200">Give these to {pinNotice.school}</p>
            <p className="mt-2">Ordering link: <span className="font-mono">{link ?? "(set your ordering link below first)"}</span></p>
            <p>Phone number: <span className="font-mono">{pinNotice.phone}</span></p>
            <p>PIN: <span className="font-mono text-lg font-bold">{pinNotice.pin}</span></p>
            <p className="mt-2 text-xs text-amber-200/80">This PIN is shown only now. If it is lost, use &quot;New PIN&quot; on the school.</p>
            <button onClick={() => setPinNotice(null)} className="mt-2 text-xs text-primary-600 hover:underline">Done - hide this</button>
          </div>
        )}

        {canEdit && (
          <form onSubmit={saveSchool} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">{editingId ? "Change this school" : "Add a school"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                School name
                <input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              <label className="text-sm">
                Contact person <span className="text-secondary-500">(optional)</span>
                <input maxLength={100} value={contactName} onChange={(e) => setContactName(e.target.value)} className={field} />
              </label>
              <label className="text-sm">
                Their phone number (they sign in with it)
                <input required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className={field} />
              </label>
              <label className="text-sm">
                Email <span className="text-secondary-500">(optional - invoices are copied here)</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
              <label className="text-sm">
                Delivery address <span className="text-secondary-500">(optional)</span>
                <input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Most they may owe (KES)
                  <input type="number" min={0} step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="No limit" className={field} />
                </label>
                <label className="text-sm">
                  Days to pay
                  <input type="number" min={0} max={365} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} className={field} />
                </label>
                <label className="text-sm">
                  Retention held back (%)
                  <input type="number" min={0} max={50} step="0.01" value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} className={field} />
                </label>
                <label className="text-sm">
                  Released after (days)
                  <input type="number" min={0} max={1825} value={retentionReleaseDays} onChange={(e) => setRetentionReleaseDays(e.target.value)} className={field} />
                </label>
              </div>
              <p className="text-xs text-secondary-500">Some schools hold back a share of each invoice until a date. Leave at 0 if this school pays in full. A contract can set its own.</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !name || !phone} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? "Saving..." : editingId ? "Save changes" : "Add school"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary-500/10">
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        <section className="space-y-2">
          {!schools && !error && <p className="text-sm text-secondary-500">Loading...</p>}
          {schools && schools.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No schools yet. Add your first one above.</p>}
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {schools?.map((s) => (
              <li key={s.id} className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {s.name} {s.status === "SUSPENDED" && <span className="ml-1 rounded bg-red-900 px-1.5 py-0.5 text-xs text-red-200">Not ordering</span>}
                    </p>
                    <p className="text-xs text-secondary-500">
                      {s.contactName ? `${s.contactName} · ` : ""}
                      {s.phone.replace(/^254/, "0")} · pays in {s.creditDays} days
                      {s.creditLimit !== null ? ` · limit ${kes(s.creditLimit)}` : ""}
                    </p>
                    <p className="text-xs text-secondary-500">{s.lastLoginAt ? `Last signed in ${new Date(s.lastLoginAt).toLocaleDateString("en-KE")}` : "Has not signed in yet"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-secondary-500">Owes</p>
                    <p className="font-mono text-base font-bold">{kes(s.owed)}</p>
                    {s.overdue > 0 && <p className="text-xs text-red-400">{kes(s.overdue)} late</p>}
                    {s.credit > 0 && <p className="text-xs text-green-400">{kes(s.credit)} credit</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <Link href={`/school-print/statement/${s.id}`} target="_blank" className="text-primary-600 hover:underline">Statement</Link>
                  <Link href={`/school-money?school=${s.id}`} className="text-primary-600 hover:underline">Invoices &amp; payments</Link>
                  {canEdit && (
                    <>
                      <button onClick={() => startEdit(s)} className="text-primary-600 hover:underline">Change</button>
                      <button onClick={() => void resetPin(s)} className="text-primary-600 hover:underline">New PIN</button>
                      <button onClick={() => void toggle(s)} className="text-error-600 hover:underline">{s.status === "ACTIVE" ? "Stop ordering" : "Allow ordering"}</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {canEdit && (
          <>
            <form onSubmit={savePortal} className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-semibold">Your ordering link</h2>
              <p className="text-xs text-secondary-500">Schools open this link to see your price list and order. Prices are only shown after they sign in.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Link name (letters, numbers, hyphens)
                  <input required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="jaribu-stationers" className={field} />
                </label>
                <label className="text-sm">
                  Name schools see
                  <input required minLength={2} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={field} />
                </label>
              </div>
              {link && <p className="text-sm">Your link: <span className="select-all font-mono">{link}</span></p>}
              <div className="flex items-center gap-4">
                <button type="submit" disabled={busy || !slug || !displayName} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  Save link
                </button>
                {portal && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await apiPut("/school-supplier/portal", { slug: portal.slug, displayName: portal.displayName, enabled: !portal.enabled });
                        await load();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Could not change that.");
                      }
                    }}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    {portal.enabled ? "Switch ordering off" : "Switch ordering on"}
                  </button>
                )}
              </div>
            </form>

            <form onSubmit={saveBusiness} className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-semibold">Your business details on printed documents</h2>
              <p className="text-xs text-secondary-500">Printed at the top of invoices, delivery notes, receipts and statements{org ? ` (under the name ${org.name})` : ""}.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  Address
                  <input maxLength={300} value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} placeholder="P.O. Box 123, Kisumu" className={field} />
                </label>
                <label className="text-sm">
                  Phone
                  <input maxLength={30} value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} className={field} />
                </label>
                <label className="text-sm">
                  Email
                  <input maxLength={200} value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} className={field} />
                </label>
                <label className="text-sm sm:col-span-2">
                  Bottom of the invoice <span className="text-secondary-500">(bank details, terms)</span>
                  <input maxLength={500} value={bizFooter} onChange={(e) => setBizFooter(e.target.value)} placeholder="Cheques payable to ... · Bank: ... Account: ..." className={field} />
                </label>
              </div>
              <button type="submit" disabled={busy} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                Save details
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
