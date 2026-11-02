"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { downloadCsv } from "../../../../lib/csv-download";
import { CON_BRAND, ConApiError, conSend, errorText, hasConRole, kes } from "../../../../lib/construction";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface Item { id: string; code: string | null; description: string; unit: string; qty: number; rate: number; amount: number }
interface Section { id: string; code: string | null; name: string; items: Item[]; total: number }
interface Bq { contractSum: number; total: number; difference: number; locked: boolean; sections: Section[] }
interface Preview {
  sections: { code: string | null; name: string; items: number; total: number; preview: { code: string | null; description: string; unit: string; qty: number; rate: number; amount: number }[] }[];
  itemCount: number; total: number; contractSum: number; difference: number; errors: string[]; warnings: string[]; saved: boolean;
}

const TEMPLATE = "Item,Description,Unit,Qty,Rate,Amount\n,BILL NO. 1 - PRELIMINARIES,,,,\nA,Site establishment,Item,,,250000\n,BILL NO. 2 - SUBSTRUCTURE,,,,\nA,Excavate foundation trenches,m3,40,650,26000\nB,Concrete class 20 in footings,m3,12,14500,174000\n";
const qtyFmt = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 3 });

export function BqTab({ project: p, reload }: TabProps) {
  const me = useConMe();
  const canEdit = hasConRole(me, "CON_CONTRACTS_MGR", "CON_QS");
  const [bq, setBq] = useState<Bq | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");
  const [item, setItem] = useState<{ id?: string; sectionId: string; code: string; description: string; unit: string; qty: string; rate: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setBq(await apiGet<Bq>(`/construction/projects/${p.id}/bq`));
    } catch (e) {
      setError(errorText(e, "Could not load the BQ."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([load(), reload()]);
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function check(save: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await conSend<Preview>("POST", `/construction/projects/${p.id}/bq/import${save ? "?save=true" : ""}`, file);
      setPreview(save ? null : r);
      if (save) {
        setFile(null);
        await Promise.all([load(), reload()]);
      }
    } catch (e) {
      if (e instanceof ConApiError && Array.isArray(e.data.errors)) setPreview(e.data as unknown as Preview);
      setError(errorText(e, "Could not read the file."));
    } finally {
      setBusy(false);
    }
  }

  const saveItem = () =>
    item &&
    run(() =>
      conSend(item.id ? "PUT" : "POST", `/construction/projects/${p.id}/bq/items${item.id ? `/${item.id}` : ""}`, { sectionId: item.sectionId, code: item.code || undefined, description: item.description, unit: item.unit, qty: Number(item.qty), rate: Number(item.rate) }),
    ).then((ok) => ok && setItem(null));

  if (!bq) return <ErrorBox message={error} />;
  const off = Math.abs(bq.difference) >= 1;

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <Panel>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-background p-2"><p className="font-bold">{kes(bq.total)}</p><p className="text-xs text-secondary-500">BQ total</p></div>
          <div className="rounded-lg bg-background p-2"><p className="font-bold">{kes(bq.contractSum)}</p><p className="text-xs text-secondary-500">Contract sum</p></div>
          <div className="rounded-lg p-2" style={{ background: off ? "#fee2e2" : "#dcfce7" }}>
            <p className="font-bold" style={{ color: off ? "#991b1b" : "#166534" }}>{off ? `${bq.difference > 0 ? "+" : ""}${bq.difference.toLocaleString("en-KE")}` : "Matches"}</p>
            <p className="text-xs" style={{ color: off ? "#991b1b" : "#166534" }}>Difference</p>
          </div>
        </div>
        {bq.locked && <p className="mt-2 text-xs text-secondary-500">The project is in its defects period or closed, so the BQ can no longer change.</p>}
      </Panel>

      {canEdit && !bq.locked && (
        <Panel title="Import from Excel">
          <p className="text-sm text-secondary-600">Upload the BQ as .xlsx (or .csv). It needs a header row with Description, Unit, Qty, Rate (and Amount). Rows with only text become sections. Nothing is saved until you check the preview.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="text-sm" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setPreview(null))} />
            <PrimaryButton disabled={busy || !file} onClick={() => check(false)}>{busy ? "Reading..." : "Check file"}</PrimaryButton>
            <button type="button" className="text-sm underline" onClick={() => downloadCsv("bq-template.csv", TEMPLATE)}>Download a template</button>
          </div>
          {preview && (
            <div className="mt-4 space-y-2 text-sm">
              <p><strong>{preview.itemCount}</strong> items in <strong>{preview.sections.length}</strong> sections, total <strong>{kes(preview.total)}</strong> {Math.abs(preview.difference) >= 1 ? <span className="font-semibold text-red-700">({preview.difference > 0 ? "+" : ""}{preview.difference.toLocaleString("en-KE")} against the contract sum)</span> : <span className="font-semibold text-green-700">(matches the contract sum)</span>}</p>
              {preview.errors.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-red-800">
                  <p className="font-semibold">Fix these in the file, then check again:</p>
                  <ul className="list-disc pl-5">{preview.errors.slice(0, 30).map((x) => <li key={x}>{x}</li>)}</ul>
                  {preview.errors.length > 30 && <p>...and {preview.errors.length - 30} more.</p>}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">
                  <ul className="list-disc pl-5">{preview.warnings.slice(0, 20).map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              <ul className="divide-y divide-border rounded-lg border border-border">
                {preview.sections.map((s, i) => (
                  <li key={i} className="flex justify-between gap-2 px-3 py-2"><span>{s.name} <span className="text-xs text-secondary-500">({s.items} items)</span></span><span>{kes(s.total)}</span></li>
                ))}
              </ul>
              {preview.errors.length === 0 && (
                <PrimaryButton disabled={busy} onClick={() => (bq.sections.length === 0 || window.confirm("This replaces the whole current BQ. Go ahead?")) && check(true)}>
                  {bq.sections.length ? "Replace the BQ with this file" : "Save this BQ"}
                </PrimaryButton>
              )}
            </div>
          )}
        </Panel>
      )}

      {bq.sections.map((s) => (
        <Panel
          key={s.id}
          title={`${s.code ? `${s.code} - ` : ""}${s.name}`}
          action={
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold">{kes(s.total)}</span>
              {canEdit && !bq.locked && <button type="button" className="text-xs text-red-700" onClick={() => window.confirm(`Delete ${s.name} and its ${s.items.length} items?`) && run(() => conSend("DELETE", `/construction/projects/${p.id}/bq/sections/${s.id}`))}>Delete</button>}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-secondary-500">
                <tr><th className="py-1 pr-2">Item</th><th>Description</th><th>Unit</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1.5 pr-2 align-top">{i.code}</td>
                    <td className="pr-2 align-top">{i.description}</td>
                    <td className="align-top">{i.unit}</td>
                    <td className="text-right align-top">{qtyFmt(i.qty)}</td>
                    <td className="text-right align-top">{i.rate.toLocaleString("en-KE")}</td>
                    <td className="text-right align-top">{i.amount.toLocaleString("en-KE")}</td>
                    <td className="whitespace-nowrap pl-2 text-right align-top text-xs">
                      {canEdit && !bq.locked && (
                        <>
                          <button type="button" style={{ color: CON_BRAND.orange }} onClick={() => setItem({ id: i.id, sectionId: s.id, code: i.code ?? "", description: i.description, unit: i.unit, qty: String(i.qty), rate: String(i.rate) })}>Edit</button>{" "}
                          <button type="button" className="text-red-700" onClick={() => run(() => conSend("DELETE", `/construction/projects/${p.id}/bq/items/${i.id}`))}>x</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && !bq.locked && item?.sectionId !== s.id && (
            <button type="button" className="mt-2 text-sm" style={{ color: CON_BRAND.orange }} onClick={() => setItem({ sectionId: s.id, code: "", description: "", unit: "", qty: "", rate: "" })}>+ Add item</button>
          )}
          {item?.sectionId === s.id && (
            <div className="mt-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-6">
              <Field label="Item"><input className={inputClass} value={item.code} onChange={(e) => setItem({ ...item, code: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Description"><input className={inputClass} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} /></Field></div>
              <Field label="Unit"><input className={inputClass} value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} /></Field>
              <Field label="Qty"><input className={inputClass} inputMode="decimal" value={item.qty} onChange={(e) => setItem({ ...item, qty: e.target.value })} /></Field>
              <Field label="Rate"><input className={inputClass} inputMode="decimal" value={item.rate} onChange={(e) => setItem({ ...item, rate: e.target.value })} /></Field>
              <div className="flex gap-2 sm:col-span-6">
                <PrimaryButton disabled={busy || !item.description.trim() || !item.unit.trim() || item.qty === "" || item.rate === ""} onClick={saveItem}>{item.id ? "Save item" : "Add item"}</PrimaryButton>
                <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setItem(null)}>Cancel</button>
                {item.qty && item.rate && <span className="self-center text-sm text-secondary-600">= {kes(Math.round(Number(item.qty) * Number(item.rate) * 100) / 100)}</span>}
              </div>
            </div>
          )}
        </Panel>
      ))}

      {canEdit && !bq.locked && (
        <Panel title="Add a section">
          <div className="flex gap-2">
            <input className={inputClass} value={newSection} placeholder="e.g. BILL NO. 3 - SUPERSTRUCTURE" onChange={(e) => setNewSection(e.target.value)} />
            <PrimaryButton disabled={busy || !newSection.trim()} onClick={() => run(() => conSend("POST", `/construction/projects/${p.id}/bq/sections`, { name: newSection.trim() })).then((ok) => ok && setNewSection(""))}>Add</PrimaryButton>
          </div>
        </Panel>
      )}
    </div>
  );
}
