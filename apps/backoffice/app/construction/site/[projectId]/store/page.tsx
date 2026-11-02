"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../../lib/api";
import { CON_BRAND, conSend, errorText, isDirector, isUpgrade, kes } from "../../../../../lib/construction";
import { todayEat } from "../../../../../lib/con-site";
import { ConShell, useConMe } from "../../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../../components/construction/ui";

interface StockRow { variantId: string; name: string; unit: string; qty: number; value: number }
interface Lpo { id: string; number: string; status: string; supplier: { name: string }; lines: { lineItemId: string; name: string; unit: string; qty: number; received: number }[] }
interface BqSection { name: string; items: { id: string; code: string | null; description: string }[] }
interface Material { id: string; name: string; baseUnit: string; variants: { id: string }[] }
type Tab = "receive" | "issue" | "request";
const q = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 3 });

export default function StorePage() {
  return (
    <ConShell title="Site store">
      <Store />
    </ConShell>
  );
}

function Store() {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useConMe();
  const onProject = (...roles: string[]) => isDirector(me) || !!me?.projectRoles.some((r) => r.projectId === projectId && roles.includes(r.role));
  const isStore = onProject("CON_STOREKEEPER");
  const canIssue = onProject("CON_STOREKEEPER", "CON_PROJECT_MGR");
  const canRequest = onProject("CON_STOREKEEPER", "CON_PROJECT_MGR", "CON_SITE_ENGINEER", "CON_SITE_SUPERVISOR");
  const [tab, setTab] = useState<Tab>("receive");
  const [stock, setStock] = useState<{ items: StockRow[]; value: number } | null>(null);
  const [lpos, setLpos] = useState<Lpo[]>([]);
  const [bq, setBq] = useState<BqSection[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [grn, setGrn] = useState<{ lpoId: string; deliveryNote: string; qty: Record<string, string>; damaged: Record<string, string> } | null>(null);
  const [issue, setIssue] = useState<{ variantId: string; qty: string; kind: "USED" | "WASTED"; bqItemId: string; issuedTo: string; note: string } | null>(null);
  const [req, setReq] = useState<{ neededBy: string; lines: { variantId: string; qty: string }[] }>({ neededBy: "", lines: [{ variantId: "", qty: "" }] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStock(await apiGet<{ items: StockRow[]; value: number }>(`/construction/projects/${projectId}/stock`));
      setLpos((await apiGet<Lpo[]>(`/construction/projects/${projectId}/lpos`).catch(() => [])).filter((l) => l.status === "SENT" || l.status === "PART_RECEIVED"));
      setBq((await apiGet<{ sections: BqSection[] }>(`/construction/projects/${projectId}/bq`).catch(() => ({ sections: [] }))).sections);
      setMaterials(await apiGet<Material[]>("/products").catch(() => []));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load the site store."));
    }
  }, [projectId]);
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
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work - check your signal and try again."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;
  const lpo = grn ? lpos.find((l) => l.id === grn.lpoId) : null;
  const issuing = issue ? stock?.items.find((s) => s.variantId === issue.variantId) : null;

  return (
    <div className="space-y-3">
      <Link href="/construction/site" className="text-sm" style={{ color: CON_BRAND.orange }}>← Site</Link>
      <div className="grid grid-cols-3 gap-2">
        {([["receive", "Receive"], ["issue", "Issue"], ["request", "Request"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="min-h-[52px] rounded-xl text-base font-bold" style={tab === k ? { background: CON_BRAND.navy, color: "white" } : { border: `2px solid ${CON_BRAND.navy}`, color: "var(--con-ink)" }}>{l}</button>
        ))}
      </div>
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {tab === "receive" && (
        <>
          {lpos.length === 0 && <p className="text-sm text-secondary-500">No approved LPOs waiting for delivery.</p>}
          {!grn && lpos.map((l) => (
            <button key={l.id} type="button" disabled={!isStore} onClick={() => setGrn({ lpoId: l.id, deliveryNote: "", qty: {}, damaged: {} })} className="block w-full rounded-xl border border-border bg-surface p-3 text-left disabled:opacity-70">
              <p className="font-semibold">{l.number} · {l.supplier.name}</p>
              <p className="text-xs text-secondary-500">{l.lines.filter((x) => x.received < x.qty).map((x) => `${q(x.qty - x.received)} ${x.unit} ${x.name}`).join(" · ")} still to come</p>
            </button>
          ))}
          {!isStore && lpos.length > 0 && <p className="text-xs text-secondary-500">Only the storekeeper records deliveries.</p>}
          {grn && lpo && (
            <Panel title={`Delivery for ${lpo.number}`}>
              <Field label="Delivery note no."><input className={`${inputClass} text-base`} value={grn.deliveryNote} onChange={(e) => setGrn({ ...grn, deliveryNote: e.target.value })} /></Field>
              <ul className="mt-3 space-y-3">
                {lpo.lines.filter((x) => x.received < x.qty).map((x) => (
                  <li key={x.lineItemId} className="rounded-lg border border-border p-2">
                    <p className="font-medium">{x.name}</p>
                    <p className="text-xs text-secondary-500">{q(x.qty - x.received)} {x.unit} still to come</p>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <Field label="Good, received"><input className={`${inputClass} text-base`} inputMode="decimal" value={grn.qty[x.lineItemId] ?? ""} onChange={(e) => setGrn({ ...grn, qty: { ...grn.qty, [x.lineItemId]: e.target.value } })} /></Field>
                      <Field label="Damaged / short"><input className={`${inputClass} text-base`} inputMode="decimal" value={grn.damaged[x.lineItemId] ?? ""} onChange={(e) => setGrn({ ...grn, damaged: { ...grn.damaged, [x.lineItemId]: e.target.value } })} /></Field>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <PrimaryButton disabled={busy || !Object.values(grn.qty).some((v) => Number(v) > 0)} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/lpos/${grn.lpoId}/receive`, { deliveryNote: grn.deliveryNote || undefined, lines: lpo.lines.map((x) => ({ lineItemId: x.lineItemId, quantity: Number(grn.qty[x.lineItemId]) || 0, damaged: Number(grn.damaged[x.lineItemId]) || undefined })).filter((x) => x.quantity > 0 || (x.damaged ?? 0) > 0) }), "Delivery recorded - it is now in the site store.").then((ok) => ok && setGrn(null))}>Save delivery</PrimaryButton>
                <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setGrn(null)}>Back</button>
              </div>
            </Panel>
          )}
        </>
      )}

      {tab === "issue" && (
        <>
          {stock && <p className="text-sm text-secondary-600">In the store: {stock.items.filter((s) => s.qty > 0).length} materials, worth {kes(stock.value)}</p>}
          {issue && issuing && (
            <Panel title={`Issue ${issuing.name}`}>
              <p className="text-xs text-secondary-500">{q(issuing.qty)} {issuing.unit} in the store</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["USED", "WASTED"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setIssue({ ...issue, kind: k })} className="min-h-[48px] rounded-lg border-2 font-semibold" style={issue.kind === k ? { background: k === "USED" ? "#16a34a" : "#dc2626", color: "white", borderColor: "transparent" } : { borderColor: k === "USED" ? "#16a34a" : "#dc2626", color: k === "USED" ? "#16a34a" : "#dc2626" }}>{k === "USED" ? "To the works" : "Wasted / spoilt"}</button>
                ))}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label={`How much (${issuing.unit})`}><input className={`${inputClass} text-base`} inputMode="decimal" value={issue.qty} onChange={(e) => setIssue({ ...issue, qty: e.target.value })} /></Field>
                {issue.kind === "USED" && (
                  <Field label="For which BQ item">
                    <select className={`${inputClass} text-base`} value={issue.bqItemId} onChange={(e) => setIssue({ ...issue, bqItemId: e.target.value })}>
                      <option value="">Not linked</option>
                      {bq.map((s) => <optgroup key={s.name} label={s.name}>{s.items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} ` : ""}{i.description.slice(0, 60)}</option>)}</optgroup>)}
                    </select>
                  </Field>
                )}
                <Field label={issue.kind === "USED" ? "Given to" : "What happened"}><input className={`${inputClass} text-base`} value={issue.kind === "USED" ? issue.issuedTo : issue.note} onChange={(e) => setIssue(issue.kind === "USED" ? { ...issue, issuedTo: e.target.value } : { ...issue, note: e.target.value })} /></Field>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <PrimaryButton disabled={busy || !(Number(issue.qty) > 0)} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/issues`, { variantId: issue.variantId, qty: Number(issue.qty), kind: issue.kind, bqItemId: issue.kind === "USED" ? issue.bqItemId || undefined : undefined, issuedTo: issue.issuedTo || undefined, note: issue.note || undefined, issuedAt: todayEat() }), issue.kind === "USED" ? "Issued." : "Wastage recorded.").then((ok) => ok && setIssue(null))}>Save</PrimaryButton>
                <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setIssue(null)}>Back</button>
              </div>
            </Panel>
          )}
          {!issue && (
            <ul className="space-y-2">
              {stock?.items.length === 0 && <p className="text-sm text-secondary-500">The site store is empty. Deliveries arrive here.</p>}
              {stock?.items.map((s) => (
                <li key={s.variantId}>
                  <button type="button" disabled={!canIssue || s.qty <= 0} onClick={() => setIssue({ variantId: s.variantId, qty: "", kind: "USED", bqItemId: "", issuedTo: "", note: "" })} className="flex w-full items-center justify-between rounded-xl border border-border bg-surface p-3 text-left disabled:opacity-60">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-lg font-bold" style={{ color: s.qty <= 0 ? "#dc2626" : "var(--con-ink)" }}>{q(s.qty)} <span className="text-xs font-normal">{s.unit}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "request" && (
        canRequest ? (
          <Panel title="Request materials">
            {req.lines.map((l, i) => (
              <div key={i} className="mb-2 grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <select className={`${inputClass} text-base`} value={l.variantId} onChange={(e) => setReq({ ...req, lines: req.lines.map((x, j) => (j === i ? { ...x, variantId: e.target.value } : x)) })}>
                    <option value="">Material...</option>
                    {materials.map((m) => <option key={m.id} value={m.variants[0]?.id}>{m.name} ({m.baseUnit})</option>)}
                  </select>
                </div>
                <input className={`${inputClass} text-base`} inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => setReq({ ...req, lines: req.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
              </div>
            ))}
            <button type="button" className="text-sm underline" onClick={() => setReq({ ...req, lines: [...req.lines, { variantId: "", qty: "" }] })}>+ Another material</button>
            <div className="mt-2"><Field label="Needed by"><input type="date" className={`${inputClass} text-base`} value={req.neededBy} onChange={(e) => setReq({ ...req, neededBy: e.target.value })} /></Field></div>
            <div className="mt-3">
              <PrimaryButton disabled={busy || !req.lines.some((l) => l.variantId && Number(l.qty) > 0)} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/requisitions`, { neededBy: req.neededBy || undefined, lines: req.lines.filter((l) => l.variantId && Number(l.qty) > 0).map((l) => ({ variantId: l.variantId, qty: Number(l.qty) })) }), "Requisition sent for approval.").then((ok) => ok && setReq({ neededBy: "", lines: [{ variantId: "", qty: "" }] }))}>Send for approval</PrimaryButton>
            </div>
          </Panel>
        ) : <p className="text-sm text-secondary-500">Site staff raise requisitions here.</p>
      )}
    </div>
  );
}
