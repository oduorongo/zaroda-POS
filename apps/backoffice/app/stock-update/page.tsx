"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { downloadCsv, toCsv } from "../../lib/csv";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Branch {
  id: string;
  name: string;
}
interface Line {
  row: number;
  name: string;
  stock: number | null;
  price: number | null;
  stockBefore: number;
  priceBefore: number;
  stockChange: number;
  priceChanged: boolean;
}
interface Result {
  applied: boolean;
  rows: number;
  stockChanges: number;
  priceChanges: number;
  problems: { row: number; problem: string }[];
  lines: Line[];
}
interface SyncKey {
  id: string;
  name: string;
  prefix: string;
  branchId: string;
  lastUsedAt: string | null;
  requests: number;
  revokedAt: string | null;
}

const MAX_ROWS = 5000;
// Column names other systems use, mapped to ours.
const ALIASES: Record<string, string[]> = {
  sku: ["sku", "item_code", "code", "product_code", "item_no", "plu"],
  barcode: ["barcode", "ean", "upc", "bar_code"],
  stock: ["stock", "quantity", "qty", "on_hand", "qty_on_hand", "balance", "stock_level", "closing_stock"],
  price: ["price", "selling_price", "retail_price", "unit_price", "sale_price"],
};
const field = "rounded-md border border-border bg-surface p-2 text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";

function toOurColumns(raw: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [ours, names] of Object.entries(ALIASES)) {
    const found = names.find((n) => raw[n] !== undefined && String(raw[n]).trim() !== "");
    if (found) out[ours] = raw[found];
  }
  return out;
}

/** Keeping ZARODA's stock and prices in step with another POS: upload its stock list, or let it send updates with a sync key. */
export default function StockUpdatePage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keys, setKeys] = useState<SyncKey[]>([]);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      setKeys(await apiGet<SyncKey[]>("/stock-sync/keys"));
    } catch {
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSessionState(s);
    apiGet<Branch[]>("/branches")
      .then((b) => {
        setBranches(b);
        setBranchId((current) => current || b[0]?.id || "");
      })
      .catch(() => setError("Could not load your branches."));
    if (s.role === "OWNER") void loadKeys();
  }, [router, loadKeys]);

  function readFile(file: File) {
    setError(null);
    setNotice(null);
    setResult(null);
    setRows(null);
    setFileName(file.name);
    if (file.size > 5 * 1024 * 1024) return setError("That file is bigger than 5 MB. Split it into smaller files.");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/^﻿/, "").replace(/[\s-]+/g, "_"),
      complete: (parsed) => {
        const mapped = parsed.data.map(toOurColumns);
        if (mapped.length === 0) return setError("The file has no rows.");
        if (mapped.length > MAX_ROWS) return setError(`The file has ${mapped.length.toLocaleString()} rows; the most is ${MAX_ROWS.toLocaleString()}. Split it into smaller files.`);
        if (!mapped.some((r) => r.sku || r.barcode)) return setError("No SKU or barcode column found. Name the columns sku (or barcode), stock and price - or use the template.");
        setRows(mapped);
      },
      error: () => setError("Could not read that file. Save it from your other POS or Excel as CSV and try again."),
    });
  }

  async function send(dryRun: boolean) {
    if (!rows || !branchId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<Result>("/products/stock-update", { branchId, dryRun, rows });
      setResult(r);
      if (r.applied) {
        setNotice(`Done: stock changed for ${r.stockChanges} and price for ${r.priceChanges} product${r.priceChanges === 1 ? "" : "s"}.`);
        setRows(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  }

  async function createKey() {
    setError(null);
    try {
      const k = await apiPost<{ key: string }>("/stock-sync/keys", { name: keyName.trim(), branchId });
      setNewKey(k.key);
      setKeyName("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make the key.");
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Switch this key off? Your other system will stop updating ZARODA until it gets a new key.")) return;
    try {
      await apiDelete(`/stock-sync/keys/${id}`);
      await loadKeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not switch the key off.");
    }
  }

  if (!session) return null;
  const changed = result?.lines.filter((l) => l.stockChange !== 0 || l.priceChanged) ?? [];
  const apiBase = session.apiBaseUrl.replace(/\/+$/, "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold">Update stock from another POS</h1>
          <p className="text-sm text-secondary-500">
            Selling in-store on another system? Keep your online shop&apos;s stock and prices in step with it. Products are matched by SKU or barcode, so add
            them to <Link href="/products" className="underline">Products</Link> first (with the same SKU or barcode as your other POS). To stop an item selling
            online before your shop sells the last one, set a stock buffer in <Link href="/settings/online-shop" className="underline">Online shop settings</Link>.
          </p>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">1. Upload a stock list</h2>
          <p className="text-sm text-secondary-500">
            Export your stock list from your other POS (or Excel) as CSV. Columns: <b>sku</b> or <b>barcode</b>, then <b>stock</b> and/or <b>price</b>. Common names
            such as item_code, qty, quantity and selling_price are understood too. Leave stock or price empty to keep ZARODA&apos;s.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select className={field} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  Stock at {b.name}
                </option>
              ))}
            </select>
            <label className={ghost}>
              Choose file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            </label>
            <button className={ghost} onClick={() => downloadCsv("stock-update-template.csv", toCsv(["sku", "barcode", "stock", "price"], [["SUG-1KG", "6161100000011", "24", "185"], ["", "6161100000028", "10", ""]]))}>
              Template
            </button>
            {fileName && <span className="text-sm text-secondary-500">{fileName}{rows ? ` - ${rows.length.toLocaleString()} rows` : ""}</span>}
          </div>
          {rows && (
            <button className={primary} disabled={busy || !branchId} onClick={() => void send(true)}>
              {busy ? "Checking..." : "Check the list"}
            </button>
          )}

          {result && !result.applied && (
            <div className="space-y-2 text-sm">
              <p>
                {result.rows} matched · <b>{result.stockChanges}</b> stock change{result.stockChanges === 1 ? "" : "s"} · <b>{result.priceChanges}</b> price change
                {result.priceChanges === 1 ? "" : "s"}
              </p>
              {result.problems.length > 0 && (
                <div className="rounded-md border border-amber-700/50 p-2">
                  <p className="font-semibold">Fix these rows first, then choose the file again:</p>
                  <ul className="mt-1 max-h-48 overflow-auto text-xs">
                    {result.problems.map((p) => (
                      <li key={p.row}>
                        Row {p.row}: {p.problem}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changed.length > 0 && (
                <div className="max-h-72 overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-background text-left">
                      <tr>
                        <th className="p-2">Product</th>
                        <th className="p-2">Stock</th>
                        <th className="p-2">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changed.map((l) => (
                        <tr key={l.row} className="border-t border-border">
                          <td className="p-2">{l.name}</td>
                          <td className="p-2">{l.stockChange !== 0 ? `${l.stockBefore} → ${l.stock}` : "-"}</td>
                          <td className="p-2">{l.priceChanged ? `${l.priceBefore} → ${l.price}` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.problems.length === 0 && changed.length > 0 && rows && (
                <button className={primary} disabled={busy} onClick={() => void send(false)}>
                  {busy ? "Updating..." : `Update ${changed.length} product${changed.length === 1 ? "" : "s"}`}
                </button>
              )}
              {result.problems.length === 0 && changed.length === 0 && <p className="text-secondary-500">Everything already matches. Nothing to change.</p>}
            </div>
          )}
        </section>

        {session.role === "OWNER" && (
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">2. Or let your other POS update ZARODA automatically</h2>
            <p className="text-sm text-secondary-500">
              If your POS supplier (or someone technical) can send data to another system, give them a sync key. Each time they send the stock list, ZARODA updates
              at once. Keep the key secret, like a password; switch it off here if it leaks.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input className={field} placeholder="Name, e.g. Main shop POS" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
              <button className={primary} disabled={keyName.trim().length < 2 || !branchId} onClick={() => void createKey()}>
                Make a sync key
              </button>
            </div>
            {newKey && (
              <div className="rounded-md border border-amber-700/50 p-3 text-sm">
                <p className="font-semibold">Copy this key now. It is shown only once.</p>
                <code className="mt-1 block break-all rounded bg-background p-2 text-xs">{newKey}</code>
              </div>
            )}
            {keys.length > 0 && (
              <ul className="space-y-1 text-sm">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
                    <span>
                      <b>{k.name}</b> <span className="text-secondary-500">zsync_{k.prefix}_… · {branches.find((b) => b.id === k.branchId)?.name ?? "branch"} · {k.requests} update{k.requests === 1 ? "" : "s"}{k.lastUsedAt ? `, last ${new Date(k.lastUsedAt).toLocaleString("en-KE")}` : ""}</span>
                    </span>
                    {k.revokedAt ? <span className="text-xs text-secondary-500">Switched off</span> : <button className={ghost} onClick={() => void revoke(k.id)}>Switch off</button>}
                  </li>
                ))}
              </ul>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">For your POS supplier: how to send stock</summary>
              <pre className="mt-2 overflow-auto rounded bg-background p-3 text-xs">{`PUT ${apiBase}/stock-sync
Authorization: Bearer zsync_...
Content-Type: application/json

{ "rows": [
    { "sku": "SUG-1KG", "stock": 24, "price": 185 },
    { "barcode": "6161100000028", "stock": 10 }
] }

Up to 5,000 rows a call, 30 calls a minute. Add "dryRun": true to check without changing anything.
The reply lists stock and price changes, and any rows it could not match ("problems");
if any row has a problem nothing is changed.`}</pre>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}
