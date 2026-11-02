"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector } from "../../../../../lib/construction";
import { todayEat } from "../../../../../lib/con-site";
import { ConShell, useConMe } from "../../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../../../components/construction/ui";

interface Instruction { id: string; number: string; date: string; issuedBy: string | null; description: string; status: "OPEN" | "ACTIONED" | "CLOSED" }
interface ProjectParties { parties: { role: string; party: { id: string; name: string } }[] }
const COLOUR = { OPEN: CON_BRAND.orange, ACTIONED: "#2563eb", CLOSED: "#6b7280" };

export default function InstructionsPage() {
  return (
    <ConShell title="Site instructions">
      <Instructions />
    </ConShell>
  );
}

function Instructions() {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useConMe();
  const canEdit = isDirector(me) || hasConRole(me, "CON_QS") || !!me?.projectRoles.some((r) => r.projectId === projectId && ["CON_PROJECT_MGR", "CON_SITE_ENGINEER"].includes(r.role));
  const [rows, setRows] = useState<Instruction[]>([]);
  const [consultants, setConsultants] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ partyId: "", issuedByName: "", date: todayEat(), description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Instruction[]>(`/construction/projects/${projectId}/instructions`));
      const p = await apiGet<ProjectParties>(`/construction/projects/${projectId}`).catch(() => null);
      setConsultants(p?.parties.filter((x) => x.role !== "SUBCONTRACTOR").map((x) => x.party) ?? []);
    } catch (e) {
      setError(errorText(e, "Could not load instructions."));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Link href="/construction/site" className="text-sm" style={{ color: CON_BRAND.orange }}>← Site</Link>
      <ErrorBox message={error} />
      {canEdit && (
        <Panel title="Record an instruction">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="From">
              <select className={`${inputClass} text-base`} value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}>
                <option value="">Someone else - type the name</option>
                {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {!f.partyId && <Field label="Name"><input className={`${inputClass} text-base`} value={f.issuedByName} onChange={(e) => setF({ ...f, issuedByName: e.target.value })} /></Field>}
            <Field label="Date"><input type="date" className={`${inputClass} text-base`} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </div>
          <Field label="Instruction"><textarea className={`${inputClass} min-h-[90px] text-base`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <p className="mt-1 text-xs text-secondary-500">An instruction that changes the work can become a variation later (QS).</p>
          <div className="mt-3">
            <PrimaryButton disabled={busy || f.description.trim().length < 3 || (!f.partyId && !f.issuedByName.trim())} onClick={() => run(() => conSend("POST", `/construction/projects/${projectId}/instructions`, { partyId: f.partyId || undefined, issuedByName: f.issuedByName || undefined, date: f.date, description: f.description })).then((ok) => ok && setF({ ...f, description: "" }))}>
              Save instruction
            </PrimaryButton>
          </div>
        </Panel>
      )}
      <Panel title={`Register (${rows.length})`}>
        {rows.length === 0 && <p className="text-sm text-secondary-500">No instructions yet.</p>}
        <ul className="divide-y divide-border text-sm">
          {rows.map((i) => (
            <li key={i.id} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{i.number} · {i.date}</p>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: COLOUR[i.status] }}>{i.status}</span>
              </div>
              <p>{i.description}</p>
              <p className="text-xs text-secondary-500">From {i.issuedBy ?? "-"}</p>
              {canEdit && i.status !== "CLOSED" && (
                <div className="mt-1 flex gap-3 text-xs">
                  {i.status === "OPEN" && <button type="button" className="underline" onClick={() => run(() => conSend("PATCH", `/construction/projects/${projectId}/instructions/${i.id}`, { status: "ACTIONED" }))}>Mark actioned</button>}
                  <button type="button" className="underline" onClick={() => run(() => conSend("PATCH", `/construction/projects/${projectId}/instructions/${i.id}`, { status: "CLOSED" }))}>Close</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
