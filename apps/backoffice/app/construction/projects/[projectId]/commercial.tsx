"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isUpgrade, kes } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface Variation { id: string; ref: string; description: string; amount: number; status: string; instruction: { id: string; number: string } | null; createdBy: string; approvedByName: string | null; rejectedReason: string | null }
interface Valuation { id: string; number: number; kind: string; status: string; reversed: boolean; periodEnd: string; grossToDate: number; retentionHeld: number; netDue: number; certifiedAt: string | null; invoiceTotal: number | null; invoiced: boolean; received: number }
interface Retention { rate: number; limitPercent: number; cap: number; deducted: number; released: number; held: number; projectStatus: string; entries: { id: string; type: string; amount: number; reason: string | null; createdAt: string }[] }
interface Instruction { id: string; number: string; description: string; variationId: string | null }
interface Sub { id: string; ref: string; scope: string; sum: number; retentionRate: number; party: { name: string }; workToDate: number; retentionHeld: number; paid: number; approvedUnpaid: number; valuations: { id: string; number: number; grossToDate: number; retention: number; netDue: number; status: string; createdBy: string; paymentRef: string | null }[] }
interface Party { id: string; kind: string; name: string }

const COLOUR: Record<string, string> = { PROPOSED: "#6b7280", PRICED: CON_BRAND.orange, APPROVED: "#16a34a", REJECTED: "#dc2626", DRAFT: "#6b7280", SUBMITTED: "#2563eb", CERTIFIED: "#16a34a", PAID: "#065f46" };

export function CommercialTab({ project: p }: TabProps) {
  const me = useConMe();
  const pm = !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === "CON_PROJECT_MGR");
  const canVary = hasConRole(me, "CON_QS") || pm || !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === "CON_SITE_ENGINEER");
  const isCm = hasConRole(me, "CON_CONTRACTS_MGR");
  const isQs = hasConRole(me, "CON_QS");
  const isAcc = hasConRole(me, "CON_ACCOUNTANT");
  const [vos, setVos] = useState<Variation[]>([]);
  const [vals, setVals] = useState<Valuation[]>([]);
  const [ret, setRet] = useState<Retention | null>(null);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [subUpgrade, setSubUpgrade] = useState<string | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [vo, setVo] = useState({ description: "", amount: "", instructionId: "" });
  const [sub, setSub] = useState({ partyId: "", scope: "", sum: "", retentionRate: "10" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, va, r] = await Promise.all([apiGet<Variation[]>(`/construction/projects/${p.id}/variations`), apiGet<Valuation[]>(`/construction/projects/${p.id}/valuations`), apiGet<Retention>(`/construction/projects/${p.id}/retention`)]);
      setVos(v);
      setVals(va);
      setRet(r);
      setInstructions(await apiGet<Instruction[]>(`/construction/projects/${p.id}/instructions`).catch(() => []));
      try {
        setSubs(await apiGet<Sub[]>(`/construction/projects/${p.id}/subcontracts`));
      } catch (e) {
        if (isUpgrade(e)) setSubUpgrade(errorText(e, ""));
      }
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load the commercial figures."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
    apiGet<Party[]>("/construction/parties").then((x) => setParties(x.filter((y) => y.kind === "SUBCONTRACTOR"))).catch(() => undefined);
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;
  const certified = vals.filter((v) => v.status === "CERTIFIED" || v.status === "PAID");
  const certifiedNet = certified.reduce((a, v) => a + v.netDue, 0);
  const received = vals.reduce((a, v) => a + v.received, 0);
  const open = vals.find((v) => v.status === "DRAFT" || v.status === "SUBMITTED");
  const approvedVos = vos.filter((v) => v.status === "APPROVED").reduce((a, v) => a + v.amount, 0);

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
        <Stat label="Contract sum" value={kes(p.contractSum)} />
        <Stat label="Revised sum" value={kes(p.contractSum + approvedVos)} />
        <Stat label="Certified (net)" value={kes(certifiedNet)} />
        <Stat label="Retention held" value={kes(ret?.held ?? 0)} />
      </div>

      <Panel title="Valuations / IPCs" action={isQs && !open ? <Link href={`/construction/projects/${p.id}/valuations/new`} className="text-sm font-semibold" style={{ color: CON_BRAND.orange }}>+ New valuation</Link> : null}>
        {vals.length === 0 && <p className="text-sm text-secondary-500">No valuations yet.</p>}
        <ul className="divide-y divide-border text-sm">
          {vals.map((v) => (
            <li key={v.id}>
              <Link href={`/construction/projects/${p.id}/valuations/${v.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 no-underline">
                <span className="text-foreground">
                  <strong>IPC {v.number}</strong>{v.kind === "REVERSAL" ? " (reversal)" : ""}{v.reversed ? " · reversed" : ""} <span className="text-xs text-secondary-500">to {v.periodEnd}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-foreground">{kes(v.netDue)}</span>
                  {v.invoiced && <span className="text-secondary-500">invoiced · {kes(v.received)} in</span>}
                  <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ background: COLOUR[v.status] }}>{v.status.toLowerCase()}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-secondary-500">Received so far: {kes(received)} (payments and withholding certificates).</p>
      </Panel>

      <Panel title="Variations">
        <ul className="divide-y divide-border text-sm">
          {vos.map((v) => (
            <li key={v.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p><strong>{v.ref}</strong> {v.description}</p>
                <span className="flex items-center gap-2 text-xs"><span>{kes(v.amount)}</span><span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ background: COLOUR[v.status] }}>{v.status.toLowerCase()}</span></span>
              </div>
              <p className="text-xs text-secondary-500">{v.instruction ? `From ${v.instruction.number}` : "No site instruction"}{v.approvedByName ? ` · approved by ${v.approvedByName}` : ""}{v.rejectedReason ? ` · rejected: ${v.rejectedReason}` : ""}</p>
              <div className="mt-1 flex gap-3 text-xs">
                {canVary && (v.status === "PROPOSED" || v.status === "PRICED") && <button type="button" className="underline" onClick={() => { const a = window.prompt(`Price ${v.ref} (KES, negative for an omission)`, String(v.amount)); if (a !== null && Number.isFinite(Number(a))) void run(() => conSend("PUT", `/construction/projects/${p.id}/variations/${v.id}`, { description: v.description, amount: Number(a), instructionId: v.instruction?.id }), `${v.ref} priced.`); }}>Price</button>}
                {isCm && v.status === "PRICED" && v.createdBy !== me?.orgUserId && (
                  <>
                    <button type="button" className="font-semibold text-green-700" disabled={busy} onClick={() => { const name = window.prompt("Approved by (the architect / client's representative)"); if (name?.trim()) void run(() => conSend("POST", `/construction/projects/${p.id}/variations/${v.id}/decision`, { decision: "APPROVE", approvedByName: name }), `${v.ref} approved - the revised sum has changed.`); }}>Approve</button>
                    <button type="button" className="text-red-700" disabled={busy} onClick={() => { const reason = window.prompt("Why rejected?"); if (reason?.trim()) void run(() => conSend("POST", `/construction/projects/${p.id}/variations/${v.id}/decision`, { decision: "REJECT", reason }), `${v.ref} rejected.`); }}>Reject</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canVary && (
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="sm:col-span-2"><Field label="Description"><input className={inputClass} value={vo.description} onChange={(e) => setVo({ ...vo, description: e.target.value })} /></Field></div>
            <Field label="Amount (KES, 0 if not priced)"><input className={inputClass} inputMode="decimal" value={vo.amount} onChange={(e) => setVo({ ...vo, amount: e.target.value })} /></Field>
            <Field label="From site instruction">
              <select className={inputClass} value={vo.instructionId} onChange={(e) => setVo({ ...vo, instructionId: e.target.value, description: vo.description || instructions.find((i) => i.id === e.target.value)?.description || "" })}>
                <option value="">None</option>
                {instructions.filter((i) => !i.variationId).map((i) => <option key={i.id} value={i.id}>{i.number}: {i.description.slice(0, 40)}</option>)}
              </select>
            </Field>
            <div><PrimaryButton disabled={busy || vo.description.trim().length < 3} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/variations`, { description: vo.description, amount: Number(vo.amount) || 0, instructionId: vo.instructionId || undefined }), "Variation added.").then((ok) => ok && setVo({ description: "", amount: "", instructionId: "" }))}>Add variation</PrimaryButton></div>
          </div>
        )}
      </Panel>

      {ret && (
        <Panel title="Retention">
          <p className="text-sm">{ret.rate}% of each certificate, capped at {ret.limitPercent}% of the contract sum ({kes(ret.cap)}). Deducted {kes(ret.deducted)} · released {kes(ret.released)} · <strong>held {kes(ret.held)}</strong></p>
          <ul className="mt-2 divide-y divide-border text-xs">
            {ret.entries.map((e) => <li key={e.id} className="flex justify-between py-1"><span>{e.type === "DEDUCT" ? "Deducted" : "Released"} · {e.reason}</span><span>{kes(e.amount)}</span></li>)}
          </ul>
          {(isCm || isQs) && ret.held > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy || !["PRACTICAL_COMPLETION", "DLP", "CLOSED"].includes(ret.projectStatus)} className="rounded-lg border-2 px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: CON_BRAND.navy, color: "var(--con-ink)" }} onClick={() => window.confirm("Release 50% of the retention held (practical completion)? It is paid with the next certificate.") && run(() => conSend("POST", `/construction/projects/${p.id}/retention/release`, { percent: 50, stage: "PRACTICAL_COMPLETION" }), "50% released - it goes on the next certificate.")}>Release 50% (practical completion)</button>
              <button type="button" disabled={busy || !["DLP", "CLOSED"].includes(ret.projectStatus)} className="rounded-lg border-2 px-3 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: CON_BRAND.navy, color: "var(--con-ink)" }} onClick={() => window.confirm("Release all the remaining retention (end of defects period)?") && run(() => conSend("POST", `/construction/projects/${p.id}/retention/release`, { percent: 100, stage: "END_OF_DLP" }), "Remaining retention released - it goes on the next certificate.")}>Release the rest (end of DLP)</button>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Subcontracts">
        {subUpgrade && <UpgradeCard message={subUpgrade} />}
        {subs?.length === 0 && <p className="text-sm text-secondary-500">No subcontracts.</p>}
        <ul className="space-y-3">
          {subs?.map((s) => (
            <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{s.ref} · {s.party.name}</p>
              <p className="text-xs text-secondary-500">{s.scope} · {kes(s.sum)} · retention {s.retentionRate}%</p>
              <p className="text-xs">Work to date {kes(s.workToDate)} · retention held {kes(s.retentionHeld)} · paid {kes(s.paid)}{s.approvedUnpaid ? ` · ${kes(s.approvedUnpaid)} approved, not paid` : ""}</p>
              <ul className="mt-1 text-xs">
                {s.valuations.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                    <span>Valuation {v.number}: {kes(v.grossToDate)} to date, retention {kes(v.retention)}, due {kes(v.netDue)}</span>
                    <span className="flex gap-2">
                      <span className="font-semibold" style={{ color: COLOUR[v.status] }}>{v.status.toLowerCase()}{v.paymentRef ? ` (${v.paymentRef})` : ""}</span>
                      {isCm && v.status === "DRAFT" && v.createdBy !== me?.orgUserId && <button type="button" className="underline" onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/subcontracts/${s.id}/valuations/${v.id}/approve`), "Approved.")}>Approve</button>}
                      {isAcc && v.status === "APPROVED" && <button type="button" className="underline" onClick={() => { const ref = window.prompt("Payment reference (M-Pesa / bank)"); if (ref?.trim()) void run(() => conSend("POST", `/construction/projects/${p.id}/subcontracts/${s.id}/valuations/${v.id}/paid`, { paymentRef: ref }), "Marked paid."); }}>Mark paid</button>}
                    </span>
                  </li>
                ))}
              </ul>
              {isQs && !s.valuations.some((v) => v.status === "DRAFT") && <button type="button" className="mt-1 text-xs underline" style={{ color: CON_BRAND.orange }} onClick={() => { const g = window.prompt(`${s.party.name}: work done to date (KES)`, String(s.workToDate)); if (g !== null && Number(g) >= 0) void run(() => conSend("POST", `/construction/projects/${p.id}/subcontracts/${s.id}/valuations`, { grossToDate: Number(g) }), "Subcontract valuation added."); }}>+ Valuation</button>}
            </li>
          ))}
        </ul>
        {isQs && subs && (
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Field label="Subcontractor">
              <select className={inputClass} value={sub.partyId} onChange={(e) => setSub({ ...sub, partyId: e.target.value })}>
                <option value="">{parties.length ? "Choose..." : "Add one under Team & parties"}</option>
                {parties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Scope"><input className={inputClass} value={sub.scope} onChange={(e) => setSub({ ...sub, scope: e.target.value })} /></Field>
            <Field label="Subcontract sum (KES)"><input className={inputClass} inputMode="decimal" value={sub.sum} onChange={(e) => setSub({ ...sub, sum: e.target.value })} /></Field>
            <div className="flex items-end"><PrimaryButton disabled={busy || !sub.partyId || sub.scope.trim().length < 3 || !sub.sum} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/subcontracts`, { partyId: sub.partyId, scope: sub.scope, sum: Number(sub.sum), retentionRate: Number(sub.retentionRate) }), "Subcontract added.").then((ok) => ok && setSub({ partyId: "", scope: "", sum: "", retentionRate: "10" }))}>Add subcontract</PrimaryButton></div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3 shadow-sm">
      <p className="font-bold" style={{ color: "var(--con-ink)" }}>{value}</p>
      <p className="text-xs text-secondary-500">{label}</p>
    </div>
  );
}
