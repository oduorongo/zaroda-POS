"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, Card, CardContent, Input, LoadingState } from "@zaroda/ui";

interface Term {
  term: number;
  label: string;
  shareRate: number;
  dueMonth: number;
  dueDay: number;
  graceDays: number;
  fromMonth: number;
  toMonth: number;
}
interface Settings {
  terms: Term[];
  minFirstPaymentKes: number;
  setupFeeKes: number;
  payInFullDiscountRate: number;
  payInFullUntilMonth: number;
  shifts: { id: string; schoolYear: number; term: number; newDueDate: string; instalments: number; reason: string | null; platformAdminId: string; createdAt: string }[];
}
interface Business {
  organizationId: string;
  name: string;
  plan: string;
  status: string;
  instalments: { id: string; schoolYear: number; term: number; amount: number; dueDate: string; status: string; paidAt: string | null }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = "w-16 rounded-md border border-border bg-background p-1 text-sm";
const sel = "rounded-md border border-border bg-background p-1 text-sm";

/**
 * Seasonal (school-term) billing: the terms and their shares, due dates and grace, the pay-in-full discount, the minimum first payment
 * and setup fee; moving a term's due date for every school supplier at once (logged); and each business's instalments, with
 * "record payment" for money that came by bank, cash or Paybill.
 */
export default function SeasonalBillingPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shift, setShift] = useState({ schoolYear: String(new Date().getFullYear()), term: "1", dueDate: "", reason: "" });
  const [paying, setPaying] = useState<{ orgId: string; id: string; label: string } | null>(null);
  const [method, setMethod] = useState("MPESA");
  const [reference, setReference] = useState("");

  async function load() {
    try {
      const [s, b] = await Promise.all([apiGet<Settings>("/platform-admin/seasonal/settings"), apiGet<Business[]>("/platform-admin/seasonal/businesses")]);
      setSettings(s);
      setBusinesses(b);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load seasonal billing.");
    }
  }

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    setSession(s);
    void load();
  }, [router]);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const setTerm = (i: number, k: keyof Term, v: string) =>
    setSettings((s) => (s ? { ...s, terms: s.terms.map((t, n) => (n === i ? { ...t, [k]: k === "label" ? v : Number(v) } : t)) } : s));

  if (!session) return null;
  const share = settings ? settings.terms.reduce((t, x) => t + x.shareRate, 0) : 0;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Seasonal billing (school suppliers)</h1>
        {notice && <p className="rounded-md bg-success-50 p-3 text-sm text-success-700">{notice}</p>}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!settings ? (
          <LoadingState label="Loading..." />
        ) : (
          <>
            <Card>
              <CardContent className="space-y-3 py-4">
                <h2 className="font-semibold">Terms</h2>
                <p className="text-xs text-secondary-500">
                  A business joining mid-year pays the term it joins in and the rest (whole terms). Months in no term (Nov-Dec): nothing until January. A term unpaid past its grace days makes the business read-only until paid.
                </p>
                <div className="overflow-x-auto">
                  <table className="text-left text-sm">
                    <thead className="text-xs text-secondary-500">
                      <tr><th className="p-1">Term</th><th className="p-1">Share %</th><th className="p-1">Due</th><th className="p-1">Grace days</th><th className="p-1">Joining months</th></tr>
                    </thead>
                    <tbody>
                      {settings.terms.map((t, i) => (
                        <tr key={t.term}>
                          <td className="p-1"><input className="w-24 rounded-md border border-border bg-background p-1 text-sm" value={t.label} onChange={(e) => setTerm(i, "label", e.target.value)} /></td>
                          <td className="p-1"><input className={num} type="number" value={Math.round(t.shareRate * 1000) / 10} onChange={(e) => setTerm(i, "shareRate", String(Number(e.target.value) / 100))} /></td>
                          <td className="p-1">
                            <input className={num} type="number" min={1} max={28} value={t.dueDay} onChange={(e) => setTerm(i, "dueDay", e.target.value)} />{" "}
                            <select className={sel} value={t.dueMonth} onChange={(e) => setTerm(i, "dueMonth", e.target.value)}>{MONTHS.map((m, n) => <option key={m} value={n + 1}>{m}</option>)}</select>
                          </td>
                          <td className="p-1"><input className={num} type="number" min={0} value={t.graceDays} onChange={(e) => setTerm(i, "graceDays", e.target.value)} /></td>
                          <td className="p-1">
                            <select className={sel} value={t.fromMonth} onChange={(e) => setTerm(i, "fromMonth", e.target.value)}>{MONTHS.map((m, n) => <option key={m} value={n + 1}>{m}</option>)}</select> to{" "}
                            <select className={sel} value={t.toMonth} onChange={(e) => setTerm(i, "toMonth", e.target.value)}>{MONTHS.map((m, n) => <option key={m} value={n + 1}>{m}</option>)}</select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={`text-xs ${Math.abs(share - 1) > 0.0001 ? "text-error-600" : "text-secondary-500"}`}>Shares add up to {Math.round(share * 1000) / 10}% (must be 100%).</p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="text-sm">Pay-in-full discount %<Input type="number" value={Math.round(settings.payInFullDiscountRate * 1000) / 10} onChange={(e) => setSettings({ ...settings, payInFullDiscountRate: Number(e.target.value) / 100 })} /></label>
                  <label className="text-sm">Pay in full until the end of
                    <select className={`${sel} block w-full p-2`} value={settings.payInFullUntilMonth} onChange={(e) => setSettings({ ...settings, payInFullUntilMonth: Number(e.target.value) })}>{MONTHS.map((m, n) => <option key={m} value={n + 1}>{m}</option>)}</select>
                  </label>
                  <label className="text-sm">Minimum first payment (KES)<Input type="number" value={settings.minFirstPaymentKes} onChange={(e) => setSettings({ ...settings, minFirstPaymentKes: Number(e.target.value) })} /></label>
                  <label className="text-sm">Setup fee, Nov-Dec joiners (KES)<Input type="number" value={settings.setupFeeKes} onChange={(e) => setSettings({ ...settings, setupFeeKes: Number(e.target.value) })} /></label>
                </div>
                <Button disabled={busy} onClick={() => void act(async () => {
                  const { terms, minFirstPaymentKes, setupFeeKes, payInFullDiscountRate, payInFullUntilMonth } = settings;
                  await apiPatch("/platform-admin/seasonal/settings", { terms, minFirstPaymentKes, setupFeeKes, payInFullDiscountRate, payInFullUntilMonth });
                  return "Saved. New schedules use these; instalments already made keep their amounts and dates.";
                })}>Save settings</Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-4">
                <h2 className="font-semibold">Move a term&apos;s due date for everyone</h2>
                <p className="text-xs text-secondary-500">For a late capitation release: every school supplier still owing that term gets the new date (and its grace runs from it). Logged with your name.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm">School year<Input type="number" value={shift.schoolYear} onChange={(e) => setShift({ ...shift, schoolYear: e.target.value })} /></label>
                  <label className="text-sm">Term
                    <select className={`${sel} block p-2`} value={shift.term} onChange={(e) => setShift({ ...shift, term: e.target.value })}>{settings.terms.map((t) => <option key={t.term} value={t.term}>{t.label}</option>)}</select>
                  </label>
                  <label className="text-sm">New due date<Input type="date" value={shift.dueDate} onChange={(e) => setShift({ ...shift, dueDate: e.target.value })} /></label>
                  <label className="text-sm">Reason<Input value={shift.reason} onChange={(e) => setShift({ ...shift, reason: e.target.value })} placeholder="Capitation released late" /></label>
                  <Button variant="outline" disabled={busy || !shift.dueDate} onClick={() => {
                    if (!window.confirm(`Move ${shift.schoolYear} Term ${shift.term} to ${shift.dueDate} for every school supplier still owing it?`)) return;
                    void act(async () => {
                      const r = await apiPost<{ moved: number }>("/platform-admin/seasonal/shift-due-date", { schoolYear: Number(shift.schoolYear), term: Number(shift.term), dueDate: shift.dueDate, reason: shift.reason || undefined });
                      return `Moved ${r.moved} instalment${r.moved === 1 ? "" : "s"}.`;
                    });
                  }}>Move the due date</Button>
                </div>
                {settings.shifts.length > 0 && (
                  <ul className="text-xs text-secondary-500">
                    {settings.shifts.map((s) => <li key={s.id}>{new Date(s.createdAt).toLocaleString("en-KE")}: {s.schoolYear} Term {s.term} moved to {s.newDueDate} ({s.instalments} businesses){s.reason ? ` - ${s.reason}` : ""} · by {s.platformAdminId.slice(0, 8)}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-4">
                <h2 className="font-semibold">School suppliers on a seasonal plan ({businesses.length})</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-secondary-500"><tr><th className="p-2">Business</th><th className="p-2">Status</th><th className="p-2">Instalments</th></tr></thead>
                    <tbody>
                      {businesses.map((b) => (
                        <tr key={b.organizationId} className="border-t border-border align-top">
                          <td className="p-2">{b.name}<span className="block text-xs text-secondary-500">{b.plan}</span></td>
                          <td className="p-2"><Badge variant={b.status === "READ_ONLY" ? "error" : b.status === "GRACE" ? "warning" : "success"}>{b.status}</Badge></td>
                          <td className="p-2">
                            {b.instalments.map((i) => (
                              <div key={i.id} className="flex flex-wrap items-center gap-2">
                                <span>{i.schoolYear} {i.term === 0 ? "Setup" : `T${i.term}`} · {kes(i.amount)} · due {i.dueDate} · {i.status}</span>
                                {i.status === "DUE" && <button className="text-xs text-amber-500 hover:underline" onClick={() => setPaying({ orgId: b.organizationId, id: i.id, label: `${b.name} ${i.schoolYear} ${i.term === 0 ? "setup fee" : `Term ${i.term}`} (${kes(i.amount)})` })}>Record payment</button>}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {paying && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                    <p className="w-full text-sm">Record a payment for {paying.label}</p>
                    <label className="text-sm">How
                      <select className={`${sel} block p-2`} value={method} onChange={(e) => setMethod(e.target.value)}><option value="MPESA">M-Pesa (Paybill)</option><option value="BANK">Bank</option><option value="CASH">Cash</option></select>
                    </label>
                    <label className="text-sm">Reference<Input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
                    <Button disabled={busy} onClick={() => void act(async () => {
                      await apiPost(`/platform-admin/seasonal/organizations/${paying.orgId}/instalments/${paying.id}/payment`, { method, reference: reference || undefined });
                      setPaying(null);
                      setReference("");
                      return "Payment recorded; the business is open again if it was read-only.";
                    })}>Record</Button>
                    <Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
