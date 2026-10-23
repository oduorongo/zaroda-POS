"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, apiPut, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";

interface Device {
  bhfId: string;
  dvcSrlNo: string;
  status: "NOT_CONNECTED" | "ACTIVE" | "FAILED";
  bhfNm: string | null;
  connectedAt: string | null;
  lastError: string | null;
  hasKey: boolean;
}
interface Overview {
  enabled: boolean;
  environment: "SANDBOX" | "PRODUCTION";
  tin: string | null;
  taxpayerName: string | null;
  sendSales: boolean;
  salesStartAt: string | null;
  productionAvailable: boolean;
  branches: { branchId: string; branchName: string; device: Device | null }[];
}
interface Summary {
  codes: number;
  itemClasses: number;
  lastSyncedAt: string | null;
}

const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const explain = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Connecting the business to KRA's eTIMS: the switch, the PIN, one device per branch, and KRA's code lists. */
export default function EtimsSettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tin, setTin] = useState("");
  const [forms, setForms] = useState<Record<string, { bhfId: string; dvcSrlNo: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([apiGet<Overview>("/etims/settings"), apiGet<Summary>("/etims/codes/summary")]);
      setData(o);
      setSummary(s);
      setTin((t) => t || o.tin || "");
      setForms((f) => {
        const next = { ...f };
        o.branches.forEach((b, i) => {
          if (!next[b.branchId]) next[b.branchId] = { bhfId: b.device?.bhfId ?? String(i).padStart(2, "0"), dvcSrlNo: b.device?.dvcSrlNo ?? "" };
        });
        return next;
      });
      setError(null);
    } catch (e) {
      setError(explain(e, "Could not load the eTIMS setup."));
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSession(s);
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError(explain(e, "That did not work."));
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!session) return null;
  const canWrite = session.role === "MANAGER" || session.role === "OWNER";
  const anyActive = data?.branches.some((b) => b.device?.status === "ACTIVE") ?? false;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">KRA eTIMS connection</h1>
          <div className="flex gap-2">
            <Link href="/settings/etims/items" className={ghost}>Products and KRA</Link>
            <Link href="/settings/etims/documents" className={ghost}>Sales sent to KRA</Link>
            <Link href="/settings/tax" className={ghost}>Tax settings</Link>
          </div>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">
          This talks to KRA&apos;s <strong>test</strong> system only, so nothing you send here counts as a real tax record yet. Selling never waits for KRA: a sale is always completed at the till, and sent to KRA afterwards in the background.
        </p>

        {data && (
          <>
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-semibold">Your business</h2>
              <label className="block text-sm">KRA PIN
                <input disabled={!canWrite || anyActive} className={field} placeholder="A123456789Z" value={tin} onChange={(e) => setTin(e.target.value)} />
              </label>
              {anyActive && <p className="text-xs text-secondary-500">The PIN is locked while a branch is connected under it.</p>}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!canWrite} checked={data.enabled} onChange={(e) => void run("switch", () => apiPut("/etims/settings", { enabled: e.target.checked, tin: anyActive || !tin.trim() ? undefined : tin }), e.target.checked ? "eTIMS is on." : "eTIMS is off.")} />
                Use eTIMS for this business
              </label>
              <p className="text-sm text-secondary-500">Environment: <strong>Test (sandbox)</strong>. Live KRA opens after KRA has certified this integration.{data.taxpayerName ? ` KRA knows this business as "${data.taxpayerName}".` : ""}</p>
              {canWrite && !anyActive && (
                <button className={ghost} disabled={busy !== null || !tin.trim()} onClick={() => void run("pin", () => apiPut("/etims/settings", { tin }), "PIN saved.")}>Save the PIN</button>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-semibold">Branches and devices</h2>
              <p className="text-sm text-secondary-500">Each branch needs the branch ID and device serial number KRA approved for it on the eTIMS portal (apply for OSCU there first). A device can only be connected once.</p>
              {data.branches.map((b) => {
                const f = forms[b.branchId] ?? { bhfId: "00", dvcSrlNo: "" };
                const d = b.device;
                const active = d?.status === "ACTIVE";
                return (
                  <div key={b.branchId} className="space-y-2 rounded-lg border border-border p-3">
                    <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                      <span>{b.branchName}</span>
                      <span className={`rounded px-2 py-0.5 text-xs ${active ? "bg-green-950 text-green-300" : d?.status === "FAILED" ? "bg-red-950 text-red-300" : "bg-secondary-500/15"}`}>{active ? "Connected" : d?.status === "FAILED" ? "Failed" : "Not connected"}</span>
                    </p>
                    {active ? (
                      <>
                        <p className="text-sm text-secondary-500">Branch ID {d!.bhfId} · serial {d!.dvcSrlNo}{d!.bhfNm ? ` · KRA calls it "${d!.bhfNm}"` : ""}{d!.connectedAt ? ` · connected ${new Date(d!.connectedAt).toLocaleString()}` : ""}</p>
                        {canWrite && (
                          <button className="text-xs text-red-400" disabled={busy !== null} onClick={() => window.confirm("Disconnecting forgets the key KRA gave this branch. KRA only lets a device be installed once, so KRA would have to reset it before it could be connected again. Disconnect?") && void run(`d-${b.branchId}`, () => apiPost(`/etims/devices/${b.branchId}/disconnect`, {}), "Disconnected.")}>Disconnect</button>
                        )}
                      </>
                    ) : (
                      <>
                        {d?.lastError && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{d.lastError}</p>}
                        <div className="grid gap-2 sm:grid-cols-[6rem_1fr_auto]">
                          <label className="text-xs text-secondary-500">Branch ID<input className={field} maxLength={2} value={f.bhfId} onChange={(e) => setForms({ ...forms, [b.branchId]: { ...f, bhfId: e.target.value } })} /></label>
                          <label className="text-xs text-secondary-500">Device serial number<input className={field} value={f.dvcSrlNo} onChange={(e) => setForms({ ...forms, [b.branchId]: { ...f, dvcSrlNo: e.target.value } })} /></label>
                          {canWrite && <button className={`${primary} self-end`} disabled={busy !== null || !data.tin || !f.dvcSrlNo.trim()} onClick={() => void run(`c-${b.branchId}`, () => apiPost(`/etims/devices/${b.branchId}/connect`, { bhfId: f.bhfId, dvcSrlNo: f.dvcSrlNo.trim() }), `${b.branchName} is connected to KRA.`)}>{busy === `c-${b.branchId}` ? "Connecting..." : "Connect to KRA"}</button>}
                        </div>
                        {!data.tin && <p className="text-xs text-amber-500">Save the PIN first.</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-semibold">Send sales to KRA</h2>
              <p className="text-sm text-secondary-500">When this is on, each finished sale is sent to KRA with the stock it used, and a refund of a whole sale is sent as a credit note. Only sales made <strong>after you switch it on</strong> are sent. Every product on a sale must be registered with KRA first (Products and KRA); a sale with an unregistered product waits until it is.</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!canWrite || busy !== null || !data.enabled || !anyActive} checked={data.sendSales} onChange={(e) => void run("send", () => apiPut("/etims/settings", { sendSales: e.target.checked }), e.target.checked ? "Sales are now sent to KRA (the test system), starting from now." : "Sales are no longer sent to KRA.")} />
                Send my sales to KRA
              </label>
              {data.sendSales && data.salesStartAt && <p className="text-xs text-secondary-500">Sending started on {new Date(data.salesStartAt).toLocaleString()}.</p>}
              {(!data.enabled || !anyActive) && <p className="text-xs text-secondary-500">Turn eTIMS on and connect a branch first.</p>}
              <Link href="/settings/etims/documents" className={`${ghost} inline-block`}>See what has been sent</Link>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-semibold">KRA&apos;s lists</h2>
              <p className="text-sm text-secondary-500">Tax types, units, payment methods, product classifications and so on - KRA&apos;s own values, which every item and sale must use. The first download takes everything; after that only what changed.</p>
              <p className="text-sm">{summary && summary.codes > 0 ? `${summary.codes.toLocaleString()} codes and ${summary.itemClasses.toLocaleString()} product classifications downloaded${summary.lastSyncedAt ? ` (last on ${new Date(summary.lastSyncedAt).toLocaleString()})` : ""}.` : "Nothing downloaded yet."}</p>
              {canWrite && (
                <button className={primary} disabled={busy !== null || !anyActive || !data.enabled} onClick={() => void run("sync", async () => { const r = await apiPost<{ codes: number; itemClasses: number; upToDate: boolean }>("/etims/codes/sync", {}); setNotice(r.upToDate ? "Already up to date - KRA has nothing new." : `Downloaded ${r.codes} codes and ${r.itemClasses} classifications.`); }, "")}>
                  {busy === "sync" ? "Downloading..." : "Update from KRA"}
                </button>
              )}
              {(!anyActive || !data.enabled) && <p className="text-xs text-secondary-500">Turn eTIMS on and connect a branch first.</p>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
