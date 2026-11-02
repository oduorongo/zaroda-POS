"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isUpgrade, kes } from "../../../../../../lib/construction";
import { todayEat } from "../../../../../../lib/con-site";
import { ConShell, useConMe } from "../../../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../../../components/construction/ui";

interface Template {
  project: { contractSum: number; revisedSum: number | null; retentionRate: number; retentionLimit: number };
  last: { number: number; materialsOnSite: number; advanceRecovery: number } | null;
  sections: { name: string; items: { bqItemId: string; code: string | null; description: string; unit: string; qty: number; rate: number; amount: number; lastQtyToDate: number }[] }[];
  variations: { variationId: string; ref: string; description: string; amount: number; lastAmountToDate: number }[];
}
interface Valuation {
  id: string; number: number; kind: string; status: string; reversed: boolean; reverses: number | null; reversedBy: { number: number; status: string } | null; periodEnd: string; notes: string | null; createdBy: string;
  certifiedByName: string | null; certifiedRef: string | null; certifiedAt: string | null;
  workToDate: number; variationsToDate: number; materialsOnSite: number; grossToDate: number; retentionRate: number; retentionDeducted: number; retentionReleased: number; retentionHeld: number; advanceRecovery: number; previousCertified: number; netDue: number;
  vatRate: number | null; vatAmount: number | null; invoiceTotal: number | null; invoiced: boolean;
  expectedWithholding: { wht: number; whtVat: number }; balance: { covered: number; outstanding: number; settled: boolean } | null;
  receipts: { id: string; kind: string; amount: number; method: string | null; reference: string | null; certificateNo: string | null; receivedAt: string }[];
  lines: { bqItemId?: string; variationId?: string; qtyToDate?: number; amountToDate: number }[];
}

const RECEIPT_LABEL: Record<string, string> = { PAYMENT: "Payment", WHT: "Withholding tax certificate", WHT_VAT: "Withholding VAT certificate" };

export default function ValuationPage() {
  return (
    <ConShell title="Valuation">
      <ValuationScreen />
    </ConShell>
  );
}

function ValuationScreen() {
  const { projectId, valuationId } = useParams<{ projectId: string; valuationId: string }>();
  const isNew = valuationId === "new";
  const router = useRouter();
  const me = useConMe();
  const isQs = hasConRole(me, "CON_QS");
  const isCm = hasConRole(me, "CON_CONTRACTS_MGR");
  const isAcc = hasConRole(me, "CON_ACCOUNTANT");
  const [tpl, setTpl] = useState<Template | null>(null);
  const [val, setVal] = useState<Valuation | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [voAmt, setVoAmt] = useState<Record<string, string>>({});
  const [head, setHead] = useState({ periodEnd: todayEat(), materialsOnSite: "0", advanceRecovery: "0", notes: "" });
  const [cert, setCert] = useState({ certifiedByName: "", certifiedRef: "", certifiedAt: todayEat() });
  const [rcpt, setRcpt] = useState({ kind: "PAYMENT", amount: "", method: "BANK", reference: "", certificateNo: "", receivedAt: todayEat() });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = isNew ? null : await apiGet<Valuation>(`/construction/projects/${projectId}/valuations/${valuationId}`);
      setVal(v);
      const editable = isNew || (v?.status === "DRAFT" && v.kind === "VALUATION");
      const t = editable ? await apiGet<Template>(`/construction/projects/${projectId}/valuations/template`) : null;
      setTpl(t);
      if (t) {
        const q: Record<string, string> = {};
        const a: Record<string, string> = {};
        for (const s of t.sections) for (const i of s.items) q[i.bqItemId] = String(v?.lines.find((l) => l.bqItemId === i.bqItemId)?.qtyToDate ?? i.lastQtyToDate);
        for (const x of t.variations) a[x.variationId] = String(v?.lines.find((l) => l.variationId === x.variationId)?.amountToDate ?? x.lastAmountToDate);
        setQty(q);
        setVoAmt(a);
        setHead(v ? { periodEnd: v.periodEnd, materialsOnSite: String(v.materialsOnSite), advanceRecovery: String(v.advanceRecovery), notes: v.notes ?? "" } : { periodEnd: todayEat(), materialsOnSite: String(t.last?.materialsOnSite ?? 0), advanceRecovery: String(t.last?.advanceRecovery ?? 0), notes: "" });
      }
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load the valuation."));
    }
  }, [projectId, valuationId, isNew]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errorText(e, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        periodEnd: head.periodEnd, materialsOnSite: Number(head.materialsOnSite) || 0, advanceRecovery: Number(head.advanceRecovery) || 0, notes: head.notes || undefined,
        lines: [
          ...tpl.sections.flatMap((s) => s.items).filter((i) => Number(qty[i.bqItemId]) > 0).map((i) => ({ bqItemId: i.bqItemId, qtyToDate: Number(qty[i.bqItemId]) })),
          ...tpl.variations.filter((x) => Number(voAmt[x.variationId]) !== 0 && voAmt[x.variationId] !== "").map((x) => ({ variationId: x.variationId, amountToDate: Number(voAmt[x.variationId]) })),
        ],
      };
      const r = await conSend<{ id: string; warnings: string[] }>(isNew ? "POST" : "PUT", `/construction/projects/${projectId}/valuations${isNew ? "" : `/${valuationId}`}`, body);
      setWarnings(r.warnings ?? []);
      if (isNew) router.replace(`/construction/projects/${projectId}/valuations/${r.id}`);
      else {
        setNotice("Saved and worked out.");
        await load();
      }
    } catch (e) {
      setError(errorText(e, "Could not save the valuation."));
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;
  const live = tpl ? tpl.sections.flatMap((s) => s.items).reduce((a, i) => a + (Number(qty[i.bqItemId]) || 0) * i.rate, 0) : 0;
  const editing = !!tpl && (isNew || isQs);

  return (
    <div className="space-y-4">
      <Link href={`/construction/projects/${projectId}`} className="text-sm" style={{ color: CON_BRAND.orange }}>← Project</Link>
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
      {warnings.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"><ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}

      {val && (
        <Panel title={`IPC ${val.number}${val.kind === "REVERSAL" ? ` - reverses IPC ${val.reverses}` : ""}`} action={<Link href={`/construction/print/ipc/${projectId}/${val.id}`} target="_blank" className="text-sm underline" style={{ color: "var(--con-ink)" }}>Print / PDF</Link>}>
          <p className="mb-2 text-sm"><span className="font-semibold">{val.status.toLowerCase()}</span>{val.reversed ? ` · reversed by IPC ${val.reversedBy?.number}` : ""}{val.certifiedByName ? ` · certified by ${val.certifiedByName}${val.certifiedRef ? ` (${val.certifiedRef})` : ""} on ${val.certifiedAt}` : ""}</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              <Row label="BQ work to date" value={val.workToDate} />
              <Row label="Variations to date" value={val.variationsToDate} />
              <Row label="Materials on site" value={val.materialsOnSite} />
              <Row label="Gross valuation to date" value={val.grossToDate} strong />
              <Row label={`Less retention (${val.retentionRate}%, after releases)`} value={-val.retentionHeld} />
              <Row label="Less advance recovered to date" value={-val.advanceRecovery} />
              <Row label="Less certified before" value={-val.previousCertified} />
              <Row label="Net due on this certificate (excl. VAT)" value={val.netDue} strong />
              {val.vatAmount !== null && <Row label={`VAT ${val.vatRate}%`} value={val.vatAmount} />}
              {val.invoiceTotal !== null && <Row label="Invoiced (eTIMS)" value={val.invoiceTotal} strong />}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap gap-2">
            {val.status === "DRAFT" && isCm && val.createdBy !== me?.orgUserId && <PrimaryButton disabled={busy} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/valuations/${val.id}/submit`), "Approved and sent to the client's QS.")}>Approve and send to client&apos;s QS</PrimaryButton>}
            {val.status === "DRAFT" && val.createdBy === me?.orgUserId && <p className="text-xs text-secondary-500">The Contracts Manager or Director approves it before it goes to the client&apos;s QS.</p>}
            {val.status === "CERTIFIED" && val.kind === "VALUATION" && !val.invoiced && !val.reversed && val.netDue > 0 && (isAcc || isQs) && <PrimaryButton disabled={busy} onClick={() => window.confirm(`Invoice ${kes(val.netDue)} plus VAT to the client through eTIMS?`) && run(() => conSend("POST", `/construction/projects/${projectId}/valuations/${val.id}/invoice`), "Invoiced - it goes to KRA with your other sales.")}>Invoice through eTIMS</PrimaryButton>}
            {(val.status === "CERTIFIED" || val.status === "PAID") && val.kind === "VALUATION" && !val.reversed && (isQs || isCm) && <button type="button" disabled={busy} className="rounded-lg border-2 border-red-600 px-3 py-2 text-sm font-semibold text-red-700" onClick={() => window.confirm(`Reverse IPC ${val.number}? A certified IPC is never edited: a reversing certificate cancels it${val.invoiced ? " and its invoice is credited on eTIMS" : ""}. Then raise a correct valuation.`) && run(() => conSend("POST", `/construction/projects/${projectId}/valuations/${val.id}/reverse`), "Reversal raised - certify it like any certificate.")}>Reverse (correct a mistake)</button>}
          </div>
        </Panel>
      )}

      {val?.status === "SUBMITTED" && (isQs || isCm) && (
        <Panel title="Record the client's certificate">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Certified by (client's QS)"><input className={inputClass} value={cert.certifiedByName} onChange={(e) => setCert({ ...cert, certifiedByName: e.target.value })} /></Field>
            <Field label="Their certificate no."><input className={inputClass} value={cert.certifiedRef} onChange={(e) => setCert({ ...cert, certifiedRef: e.target.value })} /></Field>
            <Field label="Certified on"><input type="date" className={inputClass} value={cert.certifiedAt} onChange={(e) => setCert({ ...cert, certifiedAt: e.target.value })} /></Field>
          </div>
          <p className="mt-1 text-xs text-secondary-500">Once certified the IPC is locked. Mistakes are corrected by a reversing certificate.</p>
          <div className="mt-3"><PrimaryButton disabled={busy || cert.certifiedByName.trim().length < 2} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/valuations/${val.id}/certify`, { certifiedByName: cert.certifiedByName, certifiedRef: cert.certifiedRef || undefined, certifiedAt: cert.certifiedAt }), `IPC ${val.number} certified.`)}>Mark certified</PrimaryButton></div>
        </Panel>
      )}

      {val?.invoiceTotal !== null && val?.invoiceTotal !== undefined && (
        <Panel title="Money received">
          {val.balance && <p className="text-sm">Covered {kes(val.balance.covered)} of {kes(val.invoiceTotal)} · <strong>{val.balance.settled ? "Paid in full" : `${kes(val.balance.outstanding)} outstanding`}</strong></p>}
          <p className="text-xs text-secondary-500">If the client withholds tax: WHT about {kes(val.expectedWithholding.wht)}, withholding VAT about {kes(val.expectedWithholding.whtVat)} (from your tax settings). Record their certificates so the payment reconciles.</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {val.receipts.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1"><span>{RECEIPT_LABEL[r.kind]} · {r.receivedAt}{r.method ? ` · ${r.method}` : ""}{r.reference ? ` · ${r.reference}` : ""}{r.certificateNo ? ` · cert ${r.certificateNo}` : ""}</span><span>{kes(r.amount)}</span></li>)}
          </ul>
          {isAcc && !val.balance?.settled && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field label="What">
                <select className={inputClass} value={rcpt.kind} onChange={(e) => setRcpt({ ...rcpt, kind: e.target.value, amount: e.target.value === "WHT" ? String(val.expectedWithholding.wht) : e.target.value === "WHT_VAT" ? String(val.expectedWithholding.whtVat) : rcpt.amount })}>
                  {Object.entries(RECEIPT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Amount (KES)"><input className={inputClass} inputMode="decimal" value={rcpt.amount} onChange={(e) => setRcpt({ ...rcpt, amount: e.target.value })} /></Field>
              <Field label="Date"><input type="date" className={inputClass} value={rcpt.receivedAt} onChange={(e) => setRcpt({ ...rcpt, receivedAt: e.target.value })} /></Field>
              {rcpt.kind === "PAYMENT" ? (
                <>
                  <Field label="How">
                    <select className={inputClass} value={rcpt.method} onChange={(e) => setRcpt({ ...rcpt, method: e.target.value })}>
                      {["BANK", "MPESA", "CHEQUE", "CASH"].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Reference"><input className={inputClass} value={rcpt.reference} onChange={(e) => setRcpt({ ...rcpt, reference: e.target.value })} /></Field>
                </>
              ) : (
                <Field label="Certificate no."><input className={inputClass} value={rcpt.certificateNo} onChange={(e) => setRcpt({ ...rcpt, certificateNo: e.target.value })} /></Field>
              )}
              <div className="flex items-end"><PrimaryButton disabled={busy || !(Number(rcpt.amount) > 0)} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/valuations/${val.id}/receipts`, { kind: rcpt.kind, amount: Number(rcpt.amount), method: rcpt.kind === "PAYMENT" ? rcpt.method : undefined, reference: rcpt.reference || undefined, certificateNo: rcpt.certificateNo || undefined, receivedAt: rcpt.receivedAt }), "Recorded.").then(() => setRcpt({ ...rcpt, amount: "", reference: "", certificateNo: "" }))}>Record</PrimaryButton></div>
            </div>
          )}
        </Panel>
      )}

      {editing && tpl && (
        <Panel title={isNew ? "New valuation" : "Edit the draft"}>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Valued up to"><input type="date" className={inputClass} value={head.periodEnd} onChange={(e) => setHead({ ...head, periodEnd: e.target.value })} /></Field>
            <Field label="Materials on site (KES)"><input className={inputClass} inputMode="decimal" value={head.materialsOnSite} onChange={(e) => setHead({ ...head, materialsOnSite: e.target.value })} /></Field>
            <Field label="Advance recovered to date"><input className={inputClass} inputMode="decimal" value={head.advanceRecovery} onChange={(e) => setHead({ ...head, advanceRecovery: e.target.value })} /></Field>
            <Field label="Notes"><input className={inputClass} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></Field>
          </div>
          <p className="mt-2 text-xs text-secondary-500">Enter the quantity done <strong>to date</strong> on each item (it starts from the last certificate). Retention is {tpl.project.retentionRate}%, capped at {tpl.project.retentionLimit}% of the contract sum.</p>
          {tpl.sections.map((s) => (
            <div key={s.name} className="mt-3 overflow-x-auto">
              <p className="text-sm font-semibold">{s.name}</p>
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-left text-xs text-secondary-500"><tr><th className="py-1">Item</th><th>Description</th><th className="text-right">BQ qty</th><th className="text-right">Rate</th><th className="w-28 text-right">Qty to date</th><th className="text-right">Value</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {s.items.map((i) => {
                    const q = Number(qty[i.bqItemId]) || 0;
                    return (
                      <tr key={i.bqItemId} className={q > i.qty ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                        <td className="py-1">{i.code}</td>
                        <td className="pr-2">{i.description} <span className="text-xs text-secondary-500">{i.unit}</span></td>
                        <td className="text-right">{i.qty.toLocaleString("en-KE")}</td>
                        <td className="text-right">{i.rate.toLocaleString("en-KE")}</td>
                        <td><input className={`${inputClass} text-right`} inputMode="decimal" value={qty[i.bqItemId] ?? ""} onChange={(e) => setQty({ ...qty, [i.bqItemId]: e.target.value })} /></td>
                        <td className="text-right">{(q * i.rate).toLocaleString("en-KE", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          {tpl.variations.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-semibold">Approved variations</p>
              {tpl.variations.map((x) => (
                <div key={x.variationId} className="mt-1 grid grid-cols-3 items-center gap-2 text-sm">
                  <span className="col-span-2">{x.ref} {x.description} <span className="text-xs text-secondary-500">(approved {kes(x.amount)})</span></span>
                  <input className={`${inputClass} text-right`} inputMode="decimal" value={voAmt[x.variationId] ?? ""} onChange={(e) => setVoAmt({ ...voAmt, [x.variationId]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-right text-sm">BQ work to date: <strong>{kes(live)}</strong></p>
          <div className="mt-2"><PrimaryButton disabled={busy || !isQs} onClick={save}>{busy ? "Working out..." : isNew ? "Save valuation" : "Save changes"}</PrimaryButton></div>
          {!isQs && <p className="mt-1 text-xs text-secondary-500">The QS prepares valuations.</p>}
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr>
      <td className={`py-1.5 ${strong ? "font-semibold" : ""}`}>{label}</td>
      <td className={`text-right ${strong ? "font-semibold" : ""} ${value < 0 ? "text-red-700" : ""}`}>{value < 0 ? `(${kes(-value)})` : kes(value)}</td>
    </tr>
  );
}
