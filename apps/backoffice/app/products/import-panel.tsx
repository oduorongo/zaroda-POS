"use client";

import { useState } from "react";
import Papa from "papaparse";
import { apiPost, ApiError } from "../../lib/api";
import { CATALOG_COLUMNS, downloadCsv, TEMPLATE_ROWS, toCsv } from "../../lib/csv";

interface Branch {
  id: string;
  name: string;
}
interface RowError {
  row: number;
  field: string;
  message: string;
}
interface Summary {
  rows: number;
  newCategories: string[];
  newProducts: number;
  existingProducts: number;
  newVariants: number;
  duplicates: { row: number; sku: string; where: "file" | "catalog" }[];
  openingStockRows: number;
}
interface Result {
  ok: boolean;
  errors: RowError[];
  summary: Summary;
}

const MAX_ROWS = 5000;
const button = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";

/**
 * Bulk import of products from a CSV file, in two steps: the file is checked first (nothing is saved; every problem is listed with
 * its row), then imported in one go. The server repeats every check and the row limit - this screen is only the convenient way in.
 */
export function ImportPanel({ branches, onClose, onImported }: { branches: Branch[]; onClose: () => void; onImported: (message: string) => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function readFile(file: File) {
    setError(null);
    setResult(null);
    setRows(null);
    setFileName(file.name);
    if (file.size > 5 * 1024 * 1024) return setError("That file is bigger than 5 MB. Split it into smaller files.");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/^﻿/, ""),
      complete: (parsed) => {
        const missing = ["product_name", "sku", "price"].filter((c) => !(parsed.meta.fields ?? []).includes(c));
        if (missing.length > 0) return setError(`The file is missing the column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Use the template.`);
        if (parsed.data.length === 0) return setError("The file has no rows.");
        if (parsed.data.length > MAX_ROWS) return setError(`The file has ${parsed.data.length.toLocaleString()} rows; the most is ${MAX_ROWS.toLocaleString()}. Split it into smaller files.`);
        setRows(parsed.data);
      },
      error: () => setError("Could not read that file. Is it a CSV?"),
    });
  }

  async function send(dryRun: boolean) {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<Result & { created?: { products: number; variants: number; categories: number; stockRows: number } }>("/products/import", { branchId: branchId || undefined, dryRun, rows });
      if (dryRun) setResult(r);
      else onImported(`Imported ${r.created?.variants ?? 0} ${r.created?.variants === 1 ? "product option" : "product options"} (${r.created?.products ?? 0} new products, ${r.created?.categories ?? 0} new categories${r.created?.stockRows ? `, opening stock for ${r.created.stockRows}` : ""}).`);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Could not do that.");
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;
  return (
    <section className="mb-6 space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">Import products from a CSV file</h2>
        <button onClick={onClose} className="text-sm text-secondary-500 hover:text-foreground">Close</button>
      </div>
      <p className="text-sm text-secondary-500">
        One row per product option. Rows with the same product name become options of one product. A category that does not exist yet is created; a tax class must already exist (Tax Settings). Opening stock is recorded as stock received.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className={ghost} onClick={() => downloadCsv("products-template.csv", toCsv([...CATALOG_COLUMNS], TEMPLATE_ROWS))}>Download the template</button>
        <label className="text-sm">
          <span className="mr-2">Your file</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="text-sm" />
        </label>
      </div>
      {branches.length > 1 && (
        <label className="block text-sm">
          Branch that holds the opening stock
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 block rounded-md border border-border bg-background p-2 text-sm">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {rows && !result && (
        <div className="flex items-center gap-3">
          <p className="text-sm">{fileName}: {rows.length.toLocaleString()} rows read.</p>
          <button className={button} disabled={busy} onClick={() => void send(true)}>{busy ? "Checking..." : "Check the file"}</button>
        </div>
      )}
      {result && s && (
        <div className="space-y-3">
          {result.ok ? (
            <div className="rounded-md bg-green-950 p-3 text-sm text-green-300">
              <p className="font-semibold">The file is good. This is what will happen:</p>
              <ul className="mt-1 list-disc pl-5">
                <li>{s.newProducts} new product{s.newProducts === 1 ? "" : "s"}{s.existingProducts > 0 ? `, and options added to ${s.existingProducts} product${s.existingProducts === 1 ? "" : "s"} you already have` : ""}</li>
                <li>{s.newVariants} product option{s.newVariants === 1 ? "" : "s"} in all</li>
                <li>{s.newCategories.length === 0 ? "No new categories" : `New categories: ${s.newCategories.join(", ")}`}</li>
                <li>{s.openingStockRows === 0 ? "No opening stock" : `Opening stock recorded for ${s.openingStockRows} option${s.openingStockRows === 1 ? "" : "s"}`}</li>
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">
                {result.errors.length} problem{result.errors.length === 1 ? "" : "s"} found. Nothing has been imported. Fix them in your file and check it again.
                {s.duplicates.length > 0 && ` ${s.duplicates.length} of them ${s.duplicates.length === 1 ? "is" : "are"} product codes already used.`}
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface text-left text-xs uppercase text-secondary-500">
                    <tr><th className="p-2">Row</th><th className="p-2">Column</th><th className="p-2">Problem</th></tr>
                  </thead>
                  <tbody>
                    {result.errors.slice(0, 200).map((e, i) => (
                      <tr key={i} className="border-t border-border"><td className="p-2 font-mono">{e.row}</td><td className="p-2">{e.field}</td><td className="p-2">{e.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.errors.length > 200 && <p className="text-xs text-secondary-500">Showing the first 200 of {result.errors.length}.</p>}
            </div>
          )}
          <div className="flex gap-2">
            {result.ok && <button className={button} disabled={busy} onClick={() => void send(false)}>{busy ? "Importing..." : `Import ${s.newVariants} option${s.newVariants === 1 ? "" : "s"}`}</button>}
            <button className={ghost} onClick={() => { setResult(null); setRows(null); setFileName(""); }}>Choose another file</button>
          </div>
        </div>
      )}
    </section>
  );
}
