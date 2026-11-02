"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isDirector, isUpgrade, kes, withChecks } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../components/construction/ui";

type Status = "PREPARING" | "SUBMITTED" | "WON" | "LOST" | "WITHDRAWN";
interface Tender {
  id: string; ref: string | null; title: string; procuringEntity: string; isPublic: boolean; agpoReserved: boolean; worksClass: string; worksClassLabel: string;
  estValue: number; closingAt: string | null; bidBond: number | null; bidBondExpiresAt: string | null; status: Status; capOverrideReason: string | null;
  outcomeNote: string | null; notes: string | null; project: { id: string; code: string } | null; closed: boolean;
}

const WORKS = [
  { value: "BUILDING", label: "Building works" },
  { value: "ROADS_CIVIL", label: "Roads & civil works" },
  { value: "ELEC_MECH", label: "Electrical & mechanical" },
];
const STATUS_COLOUR: Record<Status, string> = { PREPARING: CON_BRAND.orange, SUBMITTED: "#2563eb", WON: "#16a34a", LOST: "#6b7280", WITHDRAWN: "#6b7280" };
const blank = { ref: "", title: "", procuringEntity: "", worksClass: "BUILDING", estValue: "", closingAt: "", bidBond: "", bidBondExpiresAt: "", isPublic: true, agpoReserved: false, notes: "" };

export default function TendersPage() {
  return (
    <ConShell title="Tenders">
      <Tenders />
    </ConShell>
  );
}

function Tenders() {
  const me = useConMe();
  const canEdit = hasConRole(me, "CON_CONTRACTS_MGR", "CON_QS", "CON_COMPLIANCE");
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTenders(await apiGet<Tender[]>("/construction/tenders"));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load tenders."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (r !== null && done) setNotice(done);
      await load();
      return r !== null;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(() =>
      withChecks((extra) => {
        const body = {
          ref: form.ref || undefined, title: form.title.trim(), procuringEntity: form.procuringEntity.trim(), worksClass: form.worksClass, estValue: Number(form.estValue),
          closingAt: form.closingAt ? new Date(form.closingAt).toISOString() : undefined, bidBond: form.bidBond ? Number(form.bidBond) : undefined,
          bidBondExpiresAt: form.bidBondExpiresAt || undefined, isPublic: form.isPublic, agpoReserved: form.agpoReserved, notes: form.notes || undefined, ...extra,
        };
        return editing ? conSend("PUT", `/construction/tenders/${editing}`, body) : conSend("POST", "/construction/tenders", body);
      }, isDirector(me)),
    "Tender saved.").then((ok) => ok && (setForm(blank), setEditing(null)));

  const outcome = (t: Tender, status: Exclude<Status, "PREPARING">) => {
    let note: string | undefined;
    let awardedSum: number | undefined;
    if (status === "WON") {
      const v = prompt(`Awarded sum for "${t.title}" (KES). Leave as is if it matches the bid.`, String(t.estValue));
      if (v === null) return;
      awardedSum = Number(v.replace(/,/g, "")) || t.estValue;
    } else if (status !== "SUBMITTED") {
      note = prompt(status === "LOST" ? "Why was it lost? (optional)" : "Why withdraw? (optional)") ?? undefined;
    }
    void run(
      () => withChecks((extra) => conSend("POST", `/construction/tenders/${t.id}/outcome`, { status, note, awardedSum, ...extra }), isDirector(me)),
      status === "WON" ? "Marked won - the project has been created." : `Marked ${status.toLowerCase()}.`,
    );
  };

  if (upgrade) return <UpgradeCard message={upgrade} />;

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <Panel title={`Tender register (${tenders.length})`}>
        {tenders.length === 0 && <p className="text-sm text-secondary-500">No tenders yet.</p>}
        <ul className="divide-y divide-border">
          {tenders.map((t) => (
            <li key={t.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-xs text-secondary-500">
                    {t.ref ? `${t.ref} · ` : ""}{t.procuringEntity} · {t.worksClassLabel}{t.agpoReserved ? " · AGPO" : ""}{t.isPublic ? "" : " · private"}
                  </p>
                  <p className="text-xs text-secondary-500">
                    {kes(t.estValue)}{t.closingAt ? ` · closes ${new Date(t.closingAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}` : ""}{t.bidBond ? ` · bid bond ${kes(t.bidBond)}` : ""}
                  </p>
                  {t.capOverrideReason && <p className="text-xs text-amber-700">Above the NCA cap - Director override: {t.capOverrideReason}</p>}
                  {t.outcomeNote && <p className="text-xs text-secondary-500">{t.outcomeNote}</p>}
                </div>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: STATUS_COLOUR[t.status] }}>{t.status}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {t.project && <Link href={`/construction/projects/${t.project.id}`} style={{ color: CON_BRAND.orange }}>Open project {t.project.code}</Link>}
                {canEdit && t.status === "PREPARING" && (
                  <>
                    <button type="button" className="underline" onClick={() => (setEditing(t.id), setForm({ ref: t.ref ?? "", title: t.title, procuringEntity: t.procuringEntity, worksClass: t.worksClass, estValue: String(t.estValue), closingAt: t.closingAt ? t.closingAt.slice(0, 16) : "", bidBond: t.bidBond ? String(t.bidBond) : "", bidBondExpiresAt: t.bidBondExpiresAt ?? "", isPublic: t.isPublic, agpoReserved: t.agpoReserved, notes: t.notes ?? "" }), window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }))}>Edit</button>
                    <button type="button" className="font-semibold" style={{ color: "#2563eb" }} disabled={busy} onClick={() => outcome(t, "SUBMITTED")}>Mark submitted</button>
                  </>
                )}
                {canEdit && t.status === "SUBMITTED" && (
                  <>
                    <button type="button" className="font-semibold text-green-700" disabled={busy} onClick={() => outcome(t, "WON")}>Won - create project</button>
                    <button type="button" className="text-secondary-600" disabled={busy} onClick={() => outcome(t, "LOST")}>Lost</button>
                  </>
                )}
                {canEdit && (t.status === "PREPARING" || t.status === "SUBMITTED") && (
                  <button type="button" className="text-red-700" disabled={busy} onClick={() => outcome(t, "WITHDRAWN")}>Withdraw</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {canEdit && (
        <Panel title={editing ? "Edit tender" : "Add a tender"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Procuring entity"><input className={inputClass} value={form.procuringEntity} placeholder="e.g. County Government of Migori" onChange={(e) => setForm({ ...form, procuringEntity: e.target.value })} /></Field>
            <Field label="Tender no."><input className={inputClass} value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} /></Field>
            <Field label="Works class">
              <select className={inputClass} value={form.worksClass} onChange={(e) => setForm({ ...form, worksClass: e.target.value })}>
                {WORKS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="Estimated value (KES)"><input className={inputClass} inputMode="decimal" value={form.estValue} onChange={(e) => setForm({ ...form, estValue: e.target.value })} /></Field>
            <Field label="Closing date and time"><input type="datetime-local" className={inputClass} value={form.closingAt} onChange={(e) => setForm({ ...form, closingAt: e.target.value })} /></Field>
            <Field label="Bid bond (KES)"><input className={inputClass} inputMode="decimal" value={form.bidBond} onChange={(e) => setForm({ ...form, bidBond: e.target.value })} /></Field>
            <Field label="Bid bond expires"><input type="date" className={inputClass} value={form.bidBondExpiresAt} onChange={(e) => setForm({ ...form, bidBondExpiresAt: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} /> Public procurement (PPADA)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.agpoReserved} onChange={(e) => setForm({ ...form, agpoReserved: e.target.checked })} /> Reserved for AGPO</label>
          </div>
          <p className="mt-2 text-xs text-secondary-500">The value is checked against your NCA category cap for the works class. Above it, only a Director can go ahead, with a reason.</p>
          <div className="mt-3 flex gap-2">
            <PrimaryButton disabled={busy || form.title.trim().length < 2 || form.procuringEntity.trim().length < 2 || !form.estValue} onClick={save}>{busy ? "Saving..." : editing ? "Save changes" : "Add tender"}</PrimaryButton>
            {editing && <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => (setEditing(null), setForm(blank))}>Cancel</button>}
          </div>
        </Panel>
      )}
    </div>
  );
}
