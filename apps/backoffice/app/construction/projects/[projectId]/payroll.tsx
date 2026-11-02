"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isUpgrade, kes } from "../../../../lib/construction";
import { todayEat } from "../../../../lib/con-site";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface RunRow { id: string; number: string; periodStart: string; periodEnd: string; status: string; workers: number; gross: number; deductions: number; net: number }
interface Line { id: string; name: string; trade: string; phone: string | null; canMpesa: boolean; days: number; dailyRate: number; gross: number; nssf: number; shif: number; housingLevy: number; paye: number; net: number; status: string; method: string | null; reference: string | null; failureReason: string | null; smsSent: boolean }
interface Run extends RunRow { createdBy: string; mpesaReady: boolean; lines: Line[]; payoutFees: { count: number; total: number }; smsCredits: number }

const COLOUR: Record<string, string> = { DRAFT: "#6b7280", APPROVED: "#2563eb", PAID: "#16a34a", UNPAID: "#6b7280", SENDING: CON_BRAND.orange, FAILED: "#dc2626" };
const back = (days: number) => new Date(Date.now() + 3 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10);

export function PayrollTab({ project: p }: TabProps) {
  const me = useConMe();
  const isAcc = hasConRole(me, "CON_ACCOUNTANT");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [open, setOpen] = useState<Run | null>(null);
  const [period, setPeriod] = useState({ periodStart: back(6), periodEnd: back(0) });
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await apiGet<RunRow[]>(`/construction/projects/${p.id}/payroll-runs`));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load payroll."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const show = async (id: string) => setOpen(await apiGet<Run>(`/construction/projects/${p.id}/payroll-runs/${id}`));

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = (await fn()) as { id?: string; skipped?: string[] } | undefined;
      setNotice(r?.skipped?.length ? `${done} Not sent (no M-Pesa number): ${r.skipped.join(", ")}.` : done);
      await load();
      if (r?.id) await show(r.id);
    } catch (e) {
      setError(errorText(e, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;
  const base = `/construction/projects/${p.id}/payroll-runs`;
  const waiting = open?.lines.filter((l) => l.status === "UNPAID" || l.status === "FAILED") ?? [];

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {isAcc && (
        <Panel title="New pay run from the muster roll" action={<Link href="/construction/settings#payout" className="text-sm underline" style={{ color: "var(--con-ink)" }}>M-Pesa payout account</Link>}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="From"><input type="date" className={inputClass} value={period.periodStart} onChange={(e) => setPeriod({ ...period, periodStart: e.target.value })} /></Field>
            <Field label="To"><input type="date" className={inputClass} max={todayEat()} value={period.periodEnd} onChange={(e) => setPeriod({ ...period, periodEnd: e.target.value })} /></Field>
            <div className="flex items-end"><PrimaryButton disabled={busy} onClick={() => run(() => conSend("POST", base, period), "Pay run worked out - someone else approves it before it is paid.")}>Work out pay</PrimaryButton></div>
          </div>
          <p className="mt-1 text-xs text-secondary-500">Days present x daily rate (half days count half). NSSF, SHIF, Housing Levy and PAYE come from your tax settings in force on the last day.</p>
        </Panel>
      )}

      <Panel title="Pay runs">
        {runs.length === 0 ? (
          <p className="text-sm text-secondary-500">No pay runs yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void show(r.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left">
                  <span><strong>{r.number}</strong> · {r.periodStart} to {r.periodEnd} · {r.workers} workers</span>
                  <span className="flex items-center gap-2">{kes(r.net)} net <Badge s={r.status} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open && (
        <Panel title={`${open.number} · ${open.periodStart} to ${open.periodEnd}`}>
          <p className="text-sm">Gross {kes(open.gross)} · deductions {kes(open.deductions)} · <strong>net {kes(open.net)}</strong> <Badge s={open.status} /></p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-secondary-500">
                <tr><th className="py-1">Worker</th><th className="text-right">Days</th><th className="text-right">Rate</th><th className="text-right">Gross</th><th className="text-right">NSSF</th><th className="text-right">SHIF</th><th className="text-right">Housing</th><th className="text-right">PAYE</th><th className="text-right">Net</th><th className="pl-3">Paid</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {open.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1">{l.name} <span className="text-xs text-secondary-500">{l.trade}{l.phone ? ` · ${l.phone}` : ""}</span></td>
                    <td className="text-right">{l.days}</td>
                    <td className="text-right">{l.dailyRate.toLocaleString("en-KE")}</td>
                    <td className="text-right">{l.gross.toLocaleString("en-KE")}</td>
                    <td className="text-right">{l.nssf.toLocaleString("en-KE")}</td>
                    <td className="text-right">{l.shif.toLocaleString("en-KE")}</td>
                    <td className="text-right">{l.housingLevy.toLocaleString("en-KE")}</td>
                    <td className="text-right">{l.paye.toLocaleString("en-KE")}</td>
                    <td className="text-right font-semibold">{l.net.toLocaleString("en-KE")}</td>
                    <td className="pl-3 text-xs"><Badge s={l.status} /> {l.reference ?? l.failureReason ?? ""}{l.smsSent ? " · payslip sent" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {open.status === "DRAFT" && isAcc && <PrimaryButton disabled={busy} onClick={() => run(() => conSend("POST", `${base}/${open.id}/approve`), "Approved - it can now be paid.")}>Approve</PrimaryButton>}
            {open.status === "DRAFT" && isAcc && <button type="button" disabled={busy} className="rounded-lg border px-3 py-2 text-sm" onClick={() => window.confirm(`Delete ${open.number}?`) && run(async () => { await conSend("DELETE", `${base}/${open.id}`); setOpen(null); }, "Deleted.")}>Delete draft</button>}
            {open.status === "DRAFT" && open.createdBy === me?.orgUserId && <p className="text-xs text-secondary-500">Someone other than you approves this pay run.</p>}
            {open.status === "APPROVED" && isAcc && waiting.length > 0 && (
              <>
                <PrimaryButton disabled={busy || !open.mpesaReady} onClick={() => window.confirm(`Send ${kes(waiting.reduce((a, l) => a + l.net, 0))} to ${waiting.length} workers by M-Pesa?`) && run(() => conSend("POST", `${base}/${open.id}/pay`, { method: "MPESA" }), "Sent to M-Pesa - each line turns Paid when Safaricom confirms.")}>Pay by M-Pesa</PrimaryButton>
                <Field label="Code / voucher no."><input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                <button type="button" disabled={busy} className="rounded-lg border-2 px-3 py-2 text-sm font-semibold" style={{ borderColor: CON_BRAND.navy, color: "var(--con-ink)" }} onClick={() => run(() => conSend("POST", `${base}/${open.id}/pay`, { method: "CASH", reference: ref || undefined }), "Marked paid in cash.")}>Mark paid in cash</button>
                <button type="button" disabled={busy || !ref.trim()} className="rounded-lg border-2 px-3 py-2 text-sm font-semibold" style={{ borderColor: CON_BRAND.navy, color: "var(--con-ink)" }} onClick={() => run(() => conSend("POST", `${base}/${open.id}/pay`, { method: "MPESA_MANUAL", reference: ref }), "Marked paid by M-Pesa.")}>Paid by M-Pesa myself</button>
              </>
            )}
            {open.status === "APPROVED" && !open.mpesaReady && isAcc && <p className="w-full text-xs text-secondary-500">To pay by M-Pesa from here, add your business&apos;s B2C account under Settings.</p>}
            <p className="w-full text-xs text-secondary-500">
              {open.payoutFees.count > 0 && `ZARODA payout fees on this run: ${kes(open.payoutFees.total)} (${open.payoutFees.count} M-Pesa payouts), billed next month. `}
              Payslip texts left: <span style={open.smsCredits < open.lines.length ? { color: "#dc2626", fontWeight: 600 } : undefined}>{open.smsCredits}</span>{open.smsCredits < open.lines.length ? " - top up under Plan so every worker gets a payslip." : ""}
            </p>
            {open.lines.some((l) => l.status === "SENDING") && <button type="button" className="text-sm underline" onClick={() => void show(open.id)}>Refresh</button>}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Badge({ s }: { s: string }) {
  return <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: COLOUR[s] ?? "#6b7280" }}>{s.toLowerCase()}</span>;
}
