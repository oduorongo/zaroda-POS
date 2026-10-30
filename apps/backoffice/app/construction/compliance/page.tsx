"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { CON_BRAND, conOpenFile, conUpload, errorText, hasConRole, isUpgrade } from "../../../lib/construction";
import { ConShell, useConMe } from "../../../components/construction/con-shell";
import { ErrorBox, ExpiryBadge, Field, Panel, PrimaryButton, UpgradeCard, inputClass, type ExpiryState } from "../../../components/construction/ui";

interface Registration {
  id: string;
  worksClass: string;
  worksClassLabel: string;
  ncaCategory: number;
  regNo: string;
  registeredAt: string | null;
  licenceExpiresAt: string | null;
  state: ExpiryState;
  daysLeft: number | null;
}
interface Doc {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  refNo: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  hasFile: boolean;
  fileName: string | null;
  state: ExpiryState;
  daysLeft: number | null;
}

const WORKS = [
  { value: "BUILDING", label: "Building works" },
  { value: "ROADS_CIVIL", label: "Roads & civil works" },
  { value: "ELEC_MECH", label: "Electrical & mechanical" },
];
const DOC_TYPES = [
  { value: "NCA_CERT", label: "NCA registration certificate" },
  { value: "NCA_LICENCE", label: "NCA practising licence" },
  { value: "KRA_TCC", label: "KRA tax compliance certificate" },
  { value: "BUSINESS_PERMIT", label: "County business permit" },
  { value: "AGPO", label: "AGPO certificate" },
  { value: "INSURANCE_CAR", label: "Contractor's all risks insurance" },
  { value: "INSURANCE_PL", label: "Public liability insurance" },
  { value: "WIBA", label: "WIBA insurance" },
  { value: "OTHER", label: "Other" },
];
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const emptyDoc = { type: "NCA_LICENCE", title: "", refNo: "", issuedAt: "", expiresAt: "", notes: "" };

export default function CompliancePage() {
  return (
    <ConShell title="Compliance vault">
      <Vault />
    </ConShell>
  );
}

function Vault() {
  const me = useConMe();
  const canEdit = hasConRole(me, "CON_COMPLIANCE");
  const [regs, setRegs] = useState<Registration[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reg, setReg] = useState({ worksClass: "BUILDING", ncaCategory: "5", regNo: "", registeredAt: "", licenceExpiresAt: "" });
  const [doc, setDoc] = useState(emptyDoc);
  const [editing, setEditing] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([apiGet<Registration[]>("/construction/compliance/registrations"), apiGet<Doc[]>("/construction/compliance/docs")]);
      setRegs(r);
      setDocs(d);
      setError(null);
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load the vault."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
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
  };

  const saveReg = () =>
    run(() =>
      apiPut("/construction/compliance/registrations", {
        worksClass: reg.worksClass,
        ncaCategory: Number(reg.ncaCategory),
        regNo: reg.regNo.trim(),
        registeredAt: reg.registeredAt || undefined,
        licenceExpiresAt: reg.licenceExpiresAt || undefined,
      }),
    ).then((ok) => ok && setReg({ ...reg, regNo: "", registeredAt: "", licenceExpiresAt: "" }));

  const saveDoc = () =>
    run(async () => {
      const body = { type: doc.type, title: doc.title.trim() || DOC_TYPES.find((t) => t.value === doc.type)!.label, refNo: doc.refNo || undefined, issuedAt: doc.issuedAt || undefined, expiresAt: doc.expiresAt || undefined, notes: doc.notes || undefined };
      const saved = editing ? await apiPut<Doc>(`/construction/compliance/docs/${editing}`, body) : await apiPost<Doc>("/construction/compliance/docs", body);
      if (file) await conUpload(`/construction/compliance/docs/${saved.id}/file`, file);
    }).then((ok) => {
      if (!ok) return;
      setDoc(emptyDoc);
      setEditing(null);
      setFile(null);
    });

  if (upgrade) return <UpgradeCard message={upgrade} />;

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />

      <Panel title="NCA registration">
        {regs.length === 0 && <p className="mb-3 text-sm text-secondary-500">No NCA registration recorded yet. Tender and project values are checked against your category cap.</p>}
        <ul className="divide-y divide-border">
          {regs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-semibold">NCA{r.ncaCategory} - {r.worksClassLabel}</p>
                <p className="text-xs text-secondary-500">{r.regNo}{r.licenceExpiresAt ? ` · licence to ${r.licenceExpiresAt}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <ExpiryBadge state={r.state} daysLeft={r.daysLeft} />
                {canEdit && (
                  <button type="button" className="text-xs text-red-700" onClick={() => confirm("Remove this registration?") && run(() => apiDelete(`/construction/compliance/registrations/${r.id}`))}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            <Field label="Works class">
              <select className={inputClass} value={reg.worksClass} onChange={(e) => setReg({ ...reg, worksClass: e.target.value })}>
                {WORKS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select className={inputClass} value={reg.ncaCategory} onChange={(e) => setReg({ ...reg, ncaCategory: e.target.value })}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>NCA{n}</option>)}
              </select>
            </Field>
            <Field label="Registration no.">
              <input className={inputClass} value={reg.regNo} onChange={(e) => setReg({ ...reg, regNo: e.target.value })} />
            </Field>
            <Field label="Licence expires">
              <input type="date" className={inputClass} value={reg.licenceExpiresAt} onChange={(e) => setReg({ ...reg, licenceExpiresAt: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <PrimaryButton disabled={busy || reg.regNo.trim().length < 2} onClick={saveReg}>Save</PrimaryButton>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Documents">
        {docs.length === 0 && <p className="text-sm text-secondary-500">No documents yet.</p>}
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{d.title}</p>
                  <p className="text-xs text-secondary-500">
                    {d.typeLabel}{d.refNo ? ` · ${d.refNo}` : ""}{d.expiresAt ? ` · expires ${d.expiresAt}` : ""}
                  </p>
                </div>
                <ExpiryBadge state={d.state} daysLeft={d.daysLeft} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {d.hasFile ? (
                  <button type="button" className="font-medium" style={{ color: "var(--con-ink)" }} onClick={() => conOpenFile(`/construction/compliance/docs/${d.id}/file`).catch((e) => setError(errorText(e, "Could not open the file.")))}>
                    View file
                  </button>
                ) : (
                  <span className="text-secondary-500">No file uploaded</span>
                )}
                {canEdit && (
                  <>
                    <button
                      type="button"
                      style={{ color: CON_BRAND.orange }}
                      onClick={() => {
                        setEditing(d.id);
                        setDoc({ type: d.type, title: d.title, refNo: d.refNo ?? "", issuedAt: d.issuedAt ?? "", expiresAt: d.expiresAt ?? "", notes: d.notes ?? "" });
                        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                      }}
                    >
                      Edit / renew
                    </button>
                    <button type="button" className="text-red-700" onClick={() => confirm(`Delete "${d.title}"?`) && run(() => apiDelete(`/construction/compliance/docs/${d.id}`))}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {canEdit && (
        <Panel title={editing ? "Edit document" : "Upload a document"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className={inputClass} value={doc.type} onChange={(e) => setDoc({ ...doc, type: e.target.value })}>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Title">
              <input className={inputClass} value={doc.title} placeholder={DOC_TYPES.find((t) => t.value === doc.type)?.label} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
            </Field>
            <Field label="Reference no.">
              <input className={inputClass} value={doc.refNo} onChange={(e) => setDoc({ ...doc, refNo: e.target.value })} />
            </Field>
            <Field label="File (PDF or photo, up to 10MB)">
              <input type="file" accept={ACCEPT} className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Field label="Issued">
              <input type="date" className={inputClass} value={doc.issuedAt} onChange={(e) => setDoc({ ...doc, issuedAt: e.target.value })} />
            </Field>
            <Field label="Expires">
              <input type="date" className={inputClass} value={doc.expiresAt} onChange={(e) => setDoc({ ...doc, expiresAt: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <PrimaryButton disabled={busy} onClick={saveDoc}>{busy ? "Saving..." : editing ? "Save changes" : "Add document"}</PrimaryButton>
            {editing && (
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => (setEditing(null), setDoc(emptyDoc), setFile(null))}>
                Cancel
              </button>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
