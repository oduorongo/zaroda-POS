"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CON_BRAND, errorText, kes } from "../../../../lib/construction";
import { portalAccount, portalGet, portalPhotoUrl, portalPost } from "../../../../lib/con-portal";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../../components/construction/ui";
import { PortalFrame } from "../portal-frame";

interface Project { id: string; code: string; name: string; status: string; location: string | null; county: string | null; client: string | null; startDate: string | null; completionDate: string | null; progress: number; contractSum: number | null; revisedSum: number | null; milestones: { name: string; startDate: string; endDate: string; percentComplete: number }[] }
interface Ipc { id: string; number: number; kind: string; status: string; reversed: boolean; periodEnd: string; grossToDate: number; retentionHeld: number; previousCertified: number; netDue: number; vatAmount: number | null; invoiceTotal: number | null; certifiedByName: string | null; certifiedRef: string | null; certifiedAt: string | null }
interface IpcDetail extends Ipc { workToDate: number; variationsToDate: number; materialsOnSite: number; advanceRecovery: number; retentionRate: number; canCertify: boolean; lines: { id: string; code?: string | null; ref?: string; description: string; unit?: string; qty?: number; rate?: number; qtyToDate?: number; amountToDate: number }[] }
interface Variation { id: string; ref: string; description: string; amount: number; status: string; instruction: string | null; approvedByName: string | null; rejectedReason: string | null }
interface Instruction { id: string; number: string; date: string; issuedBy: string | null; description: string; status: string }
interface Photo { id: string; caption: string | null; takenAt: string }
interface Sub { id: string; ref: string; scope: string; sum: number; retentionRate: number; workToDate: number; retentionHeld: number; paid: number; approvedUnpaid: number; valuations: { id: string; number: number; grossToDate: number; retention: number; previousPaid: number; netDue: number; status: string; paymentRef: string | null; paidAt: string | null }[] }

const TABS: Record<string, { key: string; label: string }[]> = {
  CON_CLIENT: [{ key: "progress", label: "Progress" }, { key: "photos", label: "Photos" }, { key: "ipcs", label: "IPCs" }, { key: "variations", label: "Variations" }, { key: "instructions", label: "Instructions" }],
  CON_CONSULTANT_QS: [{ key: "ipcs", label: "IPCs" }, { key: "progress", label: "Progress" }, { key: "photos", label: "Photos" }, { key: "variations", label: "Variations" }, { key: "instructions", label: "Instructions" }],
  CON_CONSULTANT_ARCH: [{ key: "variations", label: "Variations" }, { key: "instructions", label: "Instructions" }, { key: "progress", label: "Progress" }, { key: "photos", label: "Photos" }, { key: "ipcs", label: "IPCs" }],
  CON_CONSULTANT_ENG: [{ key: "instructions", label: "Instructions" }, { key: "progress", label: "Progress" }, { key: "photos", label: "Photos" }],
  CON_SUBCONTRACTOR: [{ key: "subcontract", label: "My subcontract" }, { key: "progress", label: "Progress" }],
};
const COLOUR: Record<string, string> = { PRICED: CON_BRAND.orange, APPROVED: "#16a34a", REJECTED: "#dc2626", PROPOSED: "#6b7280", SUBMITTED: "#2563eb", CERTIFIED: "#16a34a", PAID: "#065f46", DRAFT: "#6b7280", OPEN: CON_BRAND.orange, ACTIONED: "#2563eb", CLOSED: "#6b7280" };

export default function PortalProjectPage() {
  return (
    <PortalFrame>
      <PortalProject />
    </PortalFrame>
  );
}

function PortalProject() {
  const { projectId } = useParams<{ projectId: string }>();
  const [role, setRole] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = portalAccount();
    if (!a) {
      window.location.href = "/construction/portal";
      return;
    }
    setRole(a.role);
    setTab(TABS[a.role]?.[0]?.key ?? "progress");
    portalGet<Project>(`/projects/${projectId}`).then(setProject).catch((e) => setError(errorText(e, (e as Error).message)));
  }, [projectId]);

  if (error) return <ErrorBox message={error} />;
  if (!project || !role) return <p className="text-sm">Loading...</p>;
  return (
    <>
      <Link href="/construction/portal" className="text-sm" style={{ color: CON_BRAND.orange }}>← My projects</Link>
      <div>
        <h1 className="text-lg font-bold">{project.code} · {project.name}</h1>
        <p className="text-sm text-secondary-500">{[project.location, project.county].filter(Boolean).join(", ")} · {project.status.replace(/_/g, " ").toLowerCase()} · {project.progress}% of programme done</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-border text-sm">
        {(TABS[role] ?? []).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className="whitespace-nowrap px-3 py-2" style={tab === t.key ? { borderBottom: `3px solid ${CON_BRAND.gold}`, fontWeight: 600 } : undefined}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "progress" && <Progress p={project} />}
      {tab === "photos" && <Photos projectId={projectId} />}
      {tab === "ipcs" && <Ipcs projectId={projectId} canCertify={role === "CON_CONSULTANT_QS"} />}
      {tab === "variations" && <Variations projectId={projectId} canDecide={role === "CON_CONSULTANT_ARCH"} />}
      {tab === "instructions" && <Instructions projectId={projectId} canIssue={role === "CON_CONSULTANT_ARCH" || role === "CON_CONSULTANT_ENG"} />}
      {tab === "subcontract" && <Subcontract projectId={projectId} />}
    </>
  );
}

function Badge({ s }: { s: string }) {
  return <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: COLOUR[s] ?? "#6b7280" }}>{s.toLowerCase()}</span>;
}

/** Loads a list, and re-loads it after an action. */
function useList<T>(path: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => portalGet<T[]>(path).then(setRows).catch((e) => setError(errorText(e, (e as Error).message))), [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, error, setError, load };
}

function Progress({ p }: { p: Project }) {
  return (
    <Panel title="Progress">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>Client: <strong>{p.client ?? "-"}</strong></p>
        <p>Start {p.startDate ?? "-"} · completion {p.completionDate ?? "-"}</p>
        {p.contractSum !== null && <p>Contract sum {kes(p.contractSum)}{p.revisedSum !== null ? ` · revised ${kes(p.revisedSum)}` : ""}</p>}
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-secondary-100"><div className="h-3" style={{ width: `${p.progress}%`, background: CON_BRAND.gold }} /></div>
      <ul className="mt-3 space-y-2 text-sm">
        {p.milestones.map((m) => (
          <li key={m.name}>
            <div className="flex justify-between"><span>{m.name}</span><span>{m.percentComplete}%</span></div>
            <div className="h-1.5 w-full rounded-full bg-secondary-100"><div className="h-1.5 rounded-full" style={{ width: `${m.percentComplete}%`, background: CON_BRAND.navy }} /></div>
            <span className="text-xs text-secondary-500">{m.startDate} to {m.endDate}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Photos({ projectId }: { projectId: string }) {
  const { rows, error } = useList<Photo>(`/projects/${projectId}/photos`);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (rows ?? []).slice(0, 24).forEach((p) => portalPhotoUrl(`/projects/${projectId}/photos/${p.id}/file`).then((u) => setUrls((x) => ({ ...x, [p.id]: u }))).catch(() => undefined));
  }, [rows, projectId]);
  if (error) return <ErrorBox message={error} />;
  return (
    <Panel title="Site photos">
      {rows?.length === 0 && <p className="text-sm text-secondary-500">No photos yet.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(rows ?? []).slice(0, 24).map((p) => (
          <figure key={p.id} className="overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {urls[p.id] ? <img src={urls[p.id]} alt={p.caption ?? "Site photo"} className="aspect-square w-full object-cover" /> : <div className="aspect-square w-full bg-secondary-100" />}
            <figcaption className="p-1 text-xs">{p.caption ?? ""} <span className="text-secondary-500">{p.takenAt.slice(0, 10)}</span></figcaption>
          </figure>
        ))}
      </div>
    </Panel>
  );
}

function Ipcs({ projectId, canCertify }: { projectId: string; canCertify: boolean }) {
  const { rows, error, setError, load } = useList<Ipc>(`/projects/${projectId}/valuations`);
  const [open, setOpen] = useState<IpcDetail | null>(null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const show = (id: string) => portalGet<IpcDetail>(`/projects/${projectId}/valuations/${id}`).then(setOpen).catch((e) => setError(errorText(e, (e as Error).message)));
  async function certify() {
    if (!open || !window.confirm(`Certify IPC ${open.number} for ${kes(open.netDue)} (before VAT)? It is locked once certified.`)) return;
    setBusy(true);
    try {
      await portalPost(`/projects/${projectId}/valuations/${open.id}/certify`, { certifiedRef: ref || undefined });
      await load();
      await show(open.id);
    } catch (e) {
      setError(errorText(e, (e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorBox message={error} />
      <Panel title="Interim payment certificates">
        {rows?.length === 0 && <p className="text-sm text-secondary-500">None yet.</p>}
        <ul className="divide-y divide-border text-sm">
          {(rows ?? []).map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => void show(v.id)} className="flex w-full flex-wrap justify-between gap-2 py-2 text-left">
                <span><strong>IPC {v.number}</strong>{v.kind === "REVERSAL" ? " (reversal)" : ""} · to {v.periodEnd}{v.reversed ? " · reversed" : ""}</span>
                <span className="flex items-center gap-2">{kes(v.netDue)} <Badge s={v.status} /></span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      {open && (
        <Panel title={`IPC ${open.number}`}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {([["Measured work to date", open.workToDate], ["Variations to date", open.variationsToDate], ["Materials on site", open.materialsOnSite], ["Gross to date", open.grossToDate], [`Less retention (${open.retentionRate}%)`, -open.retentionHeld], ["Less advance recovered", -open.advanceRecovery], ["Less certified before", -open.previousCertified], ["Due on this certificate (excl. VAT)", open.netDue]] as [string, number][]).map(([l, v]) => (
                <tr key={l}><td className="py-1">{l}</td><td className="text-right">{v < 0 ? `(${kes(-v)})` : kes(v)}</td></tr>
              ))}
              {open.invoiceTotal !== null && <tr><td className="py-1 font-semibold">Invoiced incl. VAT</td><td className="text-right font-semibold">{kes(open.invoiceTotal)}</td></tr>}
            </tbody>
          </table>
          {open.certifiedByName && <p className="mt-2 text-sm">Certified by {open.certifiedByName}{open.certifiedRef ? ` (${open.certifiedRef})` : ""} on {open.certifiedAt}</p>}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer">Valuation schedule ({open.lines.length} lines)</summary>
            <ul className="mt-1 divide-y divide-border text-xs">
              {open.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 py-1"><span>{l.code ?? l.ref} {l.description}{l.qtyToDate !== undefined ? ` · ${l.qtyToDate} of ${l.qty} ${l.unit}` : ""}</span><span>{kes(l.amountToDate)}</span></li>
              ))}
            </ul>
          </details>
          {canCertify && open.canCertify && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Your certificate no. (optional)"><input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              <PrimaryButton disabled={busy} onClick={certify}>Certify</PrimaryButton>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

function Variations({ projectId, canDecide }: { projectId: string; canDecide: boolean }) {
  const { rows, error, setError, load } = useList<Variation>(`/projects/${projectId}/variations`);
  const decide = async (v: Variation, decision: "APPROVE" | "REJECT") => {
    const reason = decision === "REJECT" ? window.prompt(`Why reject ${v.ref}?`) : "";
    if (reason === null) return;
    if (decision === "APPROVE" && !window.confirm(`Approve ${v.ref} for ${kes(v.amount)}? It changes the contract sum.`)) return;
    try {
      await portalPost(`/projects/${projectId}/variations/${v.id}/decision`, { decision, reason: reason || undefined });
      await load();
    } catch (e) {
      setError(errorText(e, (e as Error).message));
    }
  };
  return (
    <Panel title="Variations">
      <ErrorBox message={error} />
      {rows?.length === 0 && <p className="text-sm text-secondary-500">None yet.</p>}
      <ul className="divide-y divide-border text-sm">
        {(rows ?? []).map((v) => (
          <li key={v.id} className="py-2">
            <div className="flex flex-wrap justify-between gap-2"><span><strong>{v.ref}</strong> {v.description}{v.instruction ? ` (${v.instruction})` : ""}</span><span className="flex items-center gap-2">{kes(v.amount)} <Badge s={v.status} /></span></div>
            {v.approvedByName && <p className="text-xs text-secondary-500">Approved by {v.approvedByName}</p>}
            {v.rejectedReason && <p className="text-xs text-secondary-500">Rejected: {v.rejectedReason}</p>}
            {canDecide && v.status === "PRICED" && (
              <div className="mt-1 flex gap-2">
                <button type="button" className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: "#16a34a" }} onClick={() => void decide(v, "APPROVE")}>Approve</button>
                <button type="button" className="rounded-lg border border-red-600 px-3 py-1 text-xs font-semibold text-red-700" onClick={() => void decide(v, "REJECT")}>Reject</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Instructions({ projectId, canIssue }: { projectId: string; canIssue: boolean }) {
  const { rows, error, setError, load } = useList<Instruction>(`/projects/${projectId}/instructions`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    setBusy(true);
    try {
      await portalPost(`/projects/${projectId}/instructions`, { description: text });
      setText("");
      await load();
    } catch (e) {
      setError(errorText(e, (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ErrorBox message={error} />
      {canIssue && (
        <Panel title="Issue a site instruction">
          <textarea className={inputClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should the contractor do?" />
          <div className="mt-2"><PrimaryButton disabled={busy || text.trim().length < 3} onClick={issue}>Issue instruction</PrimaryButton></div>
        </Panel>
      )}
      <Panel title="Site instructions">
        {rows?.length === 0 && <p className="text-sm text-secondary-500">None yet.</p>}
        <ul className="divide-y divide-border text-sm">
          {(rows ?? []).map((i) => (
            <li key={i.id} className="py-2">
              <div className="flex flex-wrap justify-between gap-2"><strong>{i.number} · {i.date}</strong><Badge s={i.status} /></div>
              <p>{i.description}</p>
              {i.issuedBy && <p className="text-xs text-secondary-500">Issued by {i.issuedBy}</p>}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function Subcontract({ projectId }: { projectId: string }) {
  const { rows, error, setError, load } = useList<Sub>(`/projects/${projectId}/subcontracts`);
  const [gross, setGross] = useState<Record<string, string>>({});
  const submit = async (s: Sub) => {
    try {
      await portalPost(`/projects/${projectId}/subcontracts/${s.id}/valuations`, { grossToDate: Number(gross[s.id]) });
      setGross({ ...gross, [s.id]: "" });
      await load();
    } catch (e) {
      setError(errorText(e, (e as Error).message));
    }
  };
  return (
    <>
      <ErrorBox message={error} />
      {rows?.length === 0 && <Panel title="My subcontract"><p className="text-sm text-secondary-500">No subcontract on this project yet.</p></Panel>}
      {(rows ?? []).map((s) => (
        <Panel key={s.id} title={`${s.ref} · ${s.scope}`}>
          <p className="text-sm">Sum {kes(s.sum)} · work to date {kes(s.workToDate)} · retention held {kes(s.retentionHeld)} · paid {kes(s.paid)}{s.approvedUnpaid ? ` · approved, not yet paid ${kes(s.approvedUnpaid)}` : ""}</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {s.valuations.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2 py-1">
                <span>Valuation {v.number} · gross {kes(v.grossToDate)} less retention {kes(v.retention)} less paid before {kes(v.previousPaid)}</span>
                <span className="flex items-center gap-2">{kes(v.netDue)} <Badge s={v.status} />{v.paymentRef ? <span className="text-xs">{v.paymentRef}</span> : null}</span>
              </li>
            ))}
          </ul>
          {!s.valuations.some((v) => v.status === "DRAFT") && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Total work done to date (KES)"><input className={inputClass} inputMode="decimal" value={gross[s.id] ?? ""} onChange={(e) => setGross({ ...gross, [s.id]: e.target.value })} /></Field>
              <PrimaryButton disabled={!(Number(gross[s.id]) > 0)} onClick={() => void submit(s)}>Submit valuation</PrimaryButton>
            </div>
          )}
          {s.valuations.some((v) => v.status === "DRAFT") && <p className="mt-2 text-xs text-secondary-500">Your latest valuation is waiting for the builder to approve it.</p>}
        </Panel>
      ))}
    </>
  );
}
