"use client";

import { useState } from "react";
import { CON_BRAND, conOpenFile, conSend, errorText, hasConRole } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, ExpiryBadge, Field, Panel, PrimaryButton, inputClass } from "../../../../components/construction/ui";
import type { ProjectDetail, TabProps } from "./types";

type Permit = ProjectDetail["permits"][number];
const STATUS: Record<Permit["status"], { label: string; colour: string }> = {
  PENDING: { label: "Not yet", colour: "#6b7280" },
  APPLIED: { label: "Applied", colour: CON_BRAND.orange },
  APPROVED: { label: "Approved", colour: "#16a34a" },
  NOT_REQUIRED: { label: "Not required", colour: "#94a3b8" },
};

export function PermitsTab({ project: p, reload }: TabProps) {
  const me = useConMe();
  const canEdit = hasConRole(me, "CON_CONTRACTS_MGR", "CON_COMPLIANCE") || !!me?.projectRoles.some((r) => r.projectId === p.id && r.role === "CON_PROJECT_MGR");
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ status: "APPROVED", refNo: "", issuedAt: "", expiresAt: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (x: Permit) => {
    setOpen(x.type);
    setFile(null);
    setF({ status: x.status === "PENDING" ? "APPROVED" : x.status, refNo: x.refNo ?? "", issuedAt: x.issuedAt ?? "", expiresAt: x.expiresAt ?? "", notes: x.notes ?? "" });
  };

  async function save(type: string) {
    setBusy(true);
    setError(null);
    try {
      await conSend("PUT", `/construction/projects/${p.id}/permits/${type}`, { status: f.status, refNo: f.refNo || undefined, issuedAt: f.issuedAt || undefined, expiresAt: f.expiresAt || undefined, notes: f.notes || undefined });
      if (file) await conSend("POST", `/construction/projects/${p.id}/permits/${type}/file`, file);
      setOpen(null);
      await reload();
    } catch (e) {
      setError(errorText(e, "Could not save the permit."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Permits and approvals">
      <ErrorBox message={error} />
      <ul className="divide-y divide-border text-sm">
        {p.permits.map((x) => (
          <li key={x.type} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{x.label}</p>
                <p className="text-xs text-secondary-500">{[x.refNo, x.issuedAt && `issued ${x.issuedAt}`, x.expiresAt && `expires ${x.expiresAt}`, x.notes].filter(Boolean).join(" · ") || "Nothing recorded"}</p>
              </div>
              <div className="flex items-center gap-2">
                {x.expiresAt && <ExpiryBadge state={x.expiryState} />}
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: STATUS[x.status].colour }}>{STATUS[x.status].label}</span>
              </div>
            </div>
            <div className="mt-1 flex gap-3 text-xs">
              {x.hasFile && <button type="button" style={{ color: "var(--con-ink)" }} className="font-medium underline" onClick={() => conOpenFile(`/construction/projects/${p.id}/permits/${x.type}/file`).catch((e) => setError(errorText(e, "Could not open the file.")))}>View file</button>}
              {canEdit && open !== x.type && <button type="button" style={{ color: CON_BRAND.orange }} onClick={() => edit(x)}>Record / update</button>}
            </div>
            {open === x.type && (
              <div className="mt-3 rounded-lg border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Status">
                    <select className={inputClass} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                      {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Reference no."><input className={inputClass} value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} /></Field>
                  <Field label="File (PDF or photo)"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
                  <Field label="Issued"><input type="date" className={inputClass} value={f.issuedAt} onChange={(e) => setF({ ...f, issuedAt: e.target.value })} /></Field>
                  <Field label="Expires (if it does)"><input type="date" className={inputClass} value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
                  <Field label="Notes"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
                </div>
                <div className="mt-2 flex gap-2">
                  <PrimaryButton disabled={busy} onClick={() => save(x.type)}>{busy ? "Saving..." : "Save"}</PrimaryButton>
                  <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
