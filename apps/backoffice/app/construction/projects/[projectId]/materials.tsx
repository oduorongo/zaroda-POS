"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector, isUpgrade, kes } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface Req { id: string; number: string; status: string; neededBy: string | null; notes: string | null; createdBy: string; rejectedReason: string | null; lpos: { id: string; number: string }[]; lines: { variantId: string; name: string; unit: string; qty: number; cost: number | null; bqItem: { code: string | null; description: string } | null }[] }
interface Lpo { id: string; number: string; status: string; total: number; deliverBy: string | null; createdBy: string; supplier: { name: string }; requisition: { number: string } | null; lines: { lineItemId: string; name: string; unit: string; qty: number; received: number; rate: number }[] }
interface Recon { variantId: string; name: string; unit: string; budget: number | null; ordered: number; delivered: number; used: number; wasted: number; onHand: number; toDeliver: number; budgetLeft: number | null; wastagePercent: number; overBudget: boolean; unaccounted: number }
interface Supplier { id: string; name: string }
interface Material { id: string; name: string; baseUnit: string; variants: { id: string; cost: string | null }[] }

const STATUS_COLOUR: Record<string, string> = { SUBMITTED: CON_BRAND.orange, AWAITING_APPROVAL: CON_BRAND.orange, APPROVED: "#16a34a", SENT: "#2563eb", PART_RECEIVED: "#7c3aed", RECEIVED: "#16a34a", ORDERED: "#2563eb", REJECTED: "#dc2626", CANCELLED: "#6b7280" };
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
const q = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 3 });

export function MaterialsTab({ project: p }: TabProps) {
  const me = useConMe();
  const pm = !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === "CON_PROJECT_MGR");
  const canDecide = hasConRole(me, "CON_CONTRACTS_MGR") || pm;
  const canOrder = hasConRole(me, "CON_PROCUREMENT");
  const canBudget = hasConRole(me, "CON_QS", "CON_CONTRACTS_MGR");
  const [reqs, setReqs] = useState<Req[]>([]);
  const [lpos, setLpos] = useState<Lpo[]>([]);
  const [recon, setRecon] = useState<Recon[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [draft, setDraft] = useState<{ requisitionId?: string; supplierId: string; deliverBy: string; lines: { variantId: string; qty: string; rate: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([apiGet<Req[]>(`/construction/projects/${p.id}/requisitions`), apiGet<Lpo[]>(`/construction/projects/${p.id}/lpos`).catch(() => [])]);
      setReqs(r);
      setLpos(l);
      setRecon(await apiGet<Recon[]>(`/construction/projects/${p.id}/reconciliation`).catch(() => []));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load materials."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canOrder && !canBudget) return;
    apiGet<Supplier[]>("/suppliers").then(setSuppliers).catch(() => undefined);
    apiGet<Material[]>("/products").then(setMaterials).catch(() => undefined);
  }, [canOrder, canBudget]);

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

  const orderFrom = (r: Req) =>
    setDraft({ requisitionId: r.id, supplierId: suppliers[0]?.id ?? "", deliverBy: r.neededBy ?? "", lines: r.lines.map((l) => ({ variantId: l.variantId, qty: String(l.qty), rate: l.cost === null ? "" : String(l.cost) })) });
  const draftTotal = draft ? draft.lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0) : 0;

  const setBudget = (r: Recon) => {
    const v = window.prompt(`BQ allowance for ${r.name} (${r.unit})`, r.budget === null ? "" : String(r.budget));
    if (v === null || v.trim() === "" || !Number.isFinite(Number(v))) return;
    void run(() => conSend("PUT", `/construction/projects/${p.id}/material-budgets`, { variantId: r.variantId, qty: Number(v) }), "Allowance saved.");
  };

  if (upgrade) return <UpgradeCard message={upgrade} />;

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <Panel title="Reconciliation" action={<span className="text-xs text-secondary-500">BQ allowance vs ordered, delivered, used and left on site</span>}>
        {recon.length === 0 ? (
          <p className="text-sm text-secondary-500">Nothing ordered or allowed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-secondary-500">
                <tr><th className="py-1">Material</th><th className="text-right">BQ</th><th className="text-right">Ordered</th><th className="text-right">Delivered</th><th className="text-right">Used</th><th className="text-right">Wasted</th><th className="text-right">On site</th><th className="text-right">BQ left</th><th className="text-right">Waste %</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recon.map((r) => (
                  <tr key={r.variantId} className={r.overBudget ? "bg-red-50 dark:bg-red-950/30" : undefined}>
                    <td className="py-1.5">{r.name} <span className="text-xs text-secondary-500">({r.unit})</span>{r.unaccounted > 0.001 && <span className="ml-1 text-xs font-semibold text-red-700" title="Delivered minus issued minus on site">· {q(r.unaccounted)} unaccounted</span>}</td>
                    <td className="text-right">{canBudget ? <button type="button" className="underline decoration-dotted" onClick={() => setBudget(r)}>{r.budget === null ? "set" : q(r.budget)}</button> : r.budget === null ? "-" : q(r.budget)}</td>
                    <td className="text-right">{q(r.ordered)}</td>
                    <td className="text-right">{q(r.delivered)}{r.toDeliver > 0 && <span className="block text-[10px] text-secondary-500">{q(r.toDeliver)} to come</span>}</td>
                    <td className="text-right">{q(r.used)}</td>
                    <td className="text-right">{q(r.wasted)}</td>
                    <td className="text-right font-semibold">{q(r.onHand)}</td>
                    <td className={`text-right ${r.budgetLeft !== null && r.budgetLeft < 0 ? "font-semibold text-red-700" : ""}`}>{r.budgetLeft === null ? "-" : q(r.budgetLeft)}</td>
                    <td className={`text-right ${r.wastagePercent > 5 ? "font-semibold text-red-700" : ""}`}>{r.wastagePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canBudget && materials.length > 0 && (
          <button type="button" className="mt-2 text-sm underline" style={{ color: CON_BRAND.orange }} onClick={() => {
            const name = window.prompt(`Which material? Type part of the name (e.g. cement)`);
            const m = name && materials.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
            if (!m) return name && setError(`No material matches "${name}". Add it under Materials first.`);
            setBudget({ variantId: m.variants[0].id, name: m.name, unit: m.baseUnit, budget: null } as Recon);
          }}>+ Set an allowance for another material</button>
        )}
      </Panel>

      <Panel title="Requisitions" action={<Link href={`/construction/site/${p.id}/store`} className="text-sm" style={{ color: CON_BRAND.orange }}>Site store</Link>}>
        {reqs.length === 0 && <p className="text-sm text-secondary-500">No requisitions yet. Site staff raise them from the Site store screen.</p>}
        <ul className="divide-y divide-border text-sm">
          {reqs.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.number}{r.neededBy && <span className="ml-2 text-xs font-normal text-secondary-500">needed by {r.neededBy}</span>}</p>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: STATUS_COLOUR[r.status] ?? "#6b7280" }}>{label(r.status)}</span>
              </div>
              <p className="text-xs text-secondary-600">{r.lines.map((l) => `${q(l.qty)} ${l.unit} ${l.name}`).join(" · ")}</p>
              {r.rejectedReason && <p className="text-xs text-red-700">Rejected: {r.rejectedReason}</p>}
              {r.lpos.length > 0 && <p className="text-xs text-secondary-500">Ordered on {r.lpos.map((l) => l.number).join(", ")}</p>}
              <div className="mt-1 flex gap-3 text-xs">
                {canDecide && r.status === "SUBMITTED" && r.createdBy !== me?.orgUserId && (
                  <>
                    <button type="button" className="font-semibold text-green-700" disabled={busy} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/requisitions/${r.id}/approve`), `${r.number} approved.`)}>Approve</button>
                    <button type="button" className="text-red-700" disabled={busy} onClick={() => { const reason = window.prompt("Why reject it?"); if (reason && reason.trim().length >= 3) void run(() => conSend("POST", `/construction/projects/${p.id}/requisitions/${r.id}/reject`, { reason }), `${r.number} rejected.`); }}>Reject</button>
                  </>
                )}
                {canOrder && r.status === "APPROVED" && <button type="button" className="font-semibold" style={{ color: CON_BRAND.orange }} onClick={() => orderFrom(r)}>Raise LPO</button>}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {draft && (
        <Panel title="New LPO">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Supplier">
              <select className={inputClass} value={draft.supplierId} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}>
                <option value="">Choose...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Deliver by"><input type="date" className={inputClass} value={draft.deliverBy} onChange={(e) => setDraft({ ...draft, deliverBy: e.target.value })} /></Field>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-secondary-500"><tr><th>Material</th><th className="w-24">Qty</th><th className="w-28">Rate (KES)</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {draft.lines.map((l, i) => {
                const m = materials.find((x) => x.variants.some((v) => v.id === l.variantId));
                return (
                  <tr key={i}>
                    <td className="py-1">{m?.name ?? "Material"} <span className="text-xs text-secondary-500">{m?.baseUnit}</span></td>
                    <td><input className={inputClass} inputMode="decimal" value={l.qty} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} /></td>
                    <td><input className={inputClass} inputMode="decimal" value={l.rate} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} /></td>
                    <td className="text-right">{kes((Number(l.qty) || 0) * (Number(l.rate) || 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-right font-semibold">Total {kes(draftTotal)}</p>
          <p className="text-xs text-secondary-500">It goes to the Project Manager (or Contracts Manager / Director above their limit) for approval. You cannot approve your own LPO.</p>
          <div className="mt-3 flex gap-2">
            <PrimaryButton disabled={busy || !draft.supplierId || draft.lines.some((l) => !(Number(l.qty) > 0) || l.rate === "")} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/lpos`, { supplierId: draft.supplierId, requisitionId: draft.requisitionId, deliverBy: draft.deliverBy || undefined, lines: draft.lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), rate: Number(l.rate) })) }), "LPO raised - waiting for approval.").then((ok) => ok && setDraft(null))}>Raise LPO</PrimaryButton>
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </Panel>
      )}

      <Panel title="LPOs">
        {lpos.length === 0 && <p className="text-sm text-secondary-500">No LPOs yet.</p>}
        <ul className="divide-y divide-border text-sm">
          {lpos.map((l) => (
            <li key={l.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{l.number} · {l.supplier.name}</p>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: STATUS_COLOUR[l.status] ?? "#6b7280" }}>{label(l.status)}</span>
              </div>
              <p className="text-xs text-secondary-600">{kes(l.total)}{l.requisition ? ` · from ${l.requisition.number}` : ""}{l.deliverBy ? ` · deliver by ${l.deliverBy}` : ""}</p>
              <p className="text-xs text-secondary-500">{l.lines.map((x) => `${q(x.received)}/${q(x.qty)} ${x.unit} ${x.name}`).join(" · ")}</p>
              <div className="mt-1 flex flex-wrap gap-3 text-xs">
                <Link href={`/construction/print/lpo/${p.id}/${l.id}`} target="_blank" className="underline" style={{ color: "var(--con-ink)" }}>Print / PDF</Link>
                {canDecide && l.status === "AWAITING_APPROVAL" && l.createdBy !== me?.orgUserId && (
                  <>
                    <button type="button" className="font-semibold text-green-700" disabled={busy} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/lpos/${l.id}/approve`), `${l.number} approved - it can now go to the supplier.`)}>Approve</button>
                    <button type="button" className="text-red-700" disabled={busy} onClick={() => { const reason = window.prompt("Why reject it?"); if (reason && reason.trim().length >= 3) void run(() => conSend("POST", `/construction/projects/${p.id}/lpos/${l.id}/reject`, { reason }), `${l.number} rejected.`); }}>Reject</button>
                  </>
                )}
                {(canOrder || isDirector(me)) && ["AWAITING_APPROVAL", "SENT"].includes(l.status) && l.lines.every((x) => x.received === 0) && (
                  <button type="button" className="text-secondary-600" disabled={busy} onClick={() => window.confirm(`Cancel ${l.number}?`) && run(() => conSend("POST", `/construction/projects/${p.id}/lpos/${l.id}/cancel`), `${l.number} cancelled.`)}>Cancel</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
