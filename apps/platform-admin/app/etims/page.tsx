"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, Card, CardContent, Input, LoadingState } from "@zaroda/ui";

type Env = "SANDBOX" | "PRODUCTION";
interface Gateway {
  environment: Env;
  source: "ADMIN" | "HOST" | "NONE";
  consumerKey: string | null;
  apiUrl: string;
  tokenUrl: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}
interface Business {
  organizationId: string;
  name: string;
  enabled: boolean;
  sendSales: boolean;
  environment: Env;
  tin: string | null;
  taxpayerName: string | null;
  liveApprovedAt: string | null;
  devices: { branch: string; bhfId: string; status: string; lastError: string | null }[];
  documents: { sent: number; pending: number; rejected: number; manual: number };
  lastDocument: { kind: string; status: string; lastError: string | null; updatedAt: string } | null;
}

const LABEL: Record<Env, string> = { SANDBOX: "Test (sandbox)", PRODUCTION: "Live" };
const SOURCE: Record<Gateway["source"], string> = { ADMIN: "Saved here", HOST: "From the server settings (Render)", NONE: "Not set" };
const when = (d: string) => new Date(d).toLocaleString("en-KE");

/**
 * KRA eTIMS for ZARODA: the GavaConnect consumer key and secret for test and live (saved encrypted, tested against KRA on save), and
 * every business with eTIMS set up - its devices, how its documents are doing, and the switch that opens live eTIMS to it.
 */
export default function EtimsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [gateways, setGateways] = useState<Gateway[] | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [forms, setForms] = useState<Record<Env, { key: string; secret: string }>>({ SANDBOX: { key: "", secret: "" }, PRODUCTION: { key: "", secret: "" } });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [g, b] = await Promise.all([apiGet<Gateway[]>("/platform-admin/etims/gateways"), apiGet<Business[]>("/platform-admin/etims/businesses")]);
      setGateways(g);
      setBusinesses(b);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load eTIMS.");
    }
  }

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    setSession(s);
    void load();
  }, [router]);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const tested = (r: { ok: boolean; message: string }) => (r.ok ? `Connected: ${r.message}` : `Not connected: ${r.message}`);

  if (!session) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <h1 className="text-xl font-bold">KRA eTIMS</h1>
        {notice && <p className="rounded-md bg-secondary-100 p-3 text-sm">{notice}</p>}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!gateways ? (
          <LoadingState label="Loading..." />
        ) : (
          <>
            <p className="text-sm text-secondary-500">
              ZARODA&apos;s GavaConnect keys come from developer.go.ke. Every business&apos;s calls to KRA use them, together with that business&apos;s own PIN and branch device. Keys saved here replace the server settings within a minute; the secret is stored encrypted and never shown again.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {gateways.map((g) => {
                const f = forms[g.environment];
                const setF = (k: "key" | "secret", v: string) => setForms({ ...forms, [g.environment]: { ...f, [k]: v } });
                return (
                  <Card key={g.environment}>
                    <CardContent className="space-y-3 py-4">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold">{LABEL[g.environment]}</h2>
                        {g.lastTestOk === null ? <Badge variant="neutral">Not tested</Badge> : <Badge variant={g.lastTestOk ? "success" : "error"}>{g.lastTestOk ? "Connected" : "Not connected"}</Badge>}
                      </div>
                      <dl className="space-y-1 text-xs">
                        <div><dt className="inline text-secondary-500">Keys: </dt><dd className="inline">{SOURCE[g.source]}{g.consumerKey ? ` · ${g.consumerKey}` : ""}</dd></div>
                        <div className="break-all"><dt className="inline text-secondary-500">eTIMS address: </dt><dd className="inline">{g.apiUrl}</dd></div>
                        <div className="break-all"><dt className="inline text-secondary-500">Token address: </dt><dd className="inline">{g.tokenUrl}</dd></div>
                        {g.lastTestAt && <div><dt className="inline text-secondary-500">Last test: </dt><dd className="inline">{when(g.lastTestAt)} - {g.lastTestMessage}</dd></div>}
                      </dl>
                      <label className="block text-sm">Consumer key<Input value={f.key} onChange={(e) => setF("key", e.target.value)} autoComplete="off" /></label>
                      <label className="block text-sm">Consumer secret<Input type="password" value={f.secret} onChange={(e) => setF("secret", e.target.value)} autoComplete="new-password" /></label>
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={busy || !f.key.trim() || !f.secret.trim()} onClick={() => void act(async () => {
                          const r = await apiPut<{ ok: boolean; message: string }>(`/platform-admin/etims/gateways/${g.environment}`, { consumerKey: f.key, consumerSecret: f.secret });
                          setForms({ ...forms, [g.environment]: { key: "", secret: "" } });
                          return `Saved. ${tested(r)}`;
                        })}>Save and test</Button>
                        <Button variant="outline" disabled={busy} onClick={() => void act(async () => tested(await apiPost(`/platform-admin/etims/gateways/${g.environment}/test`, {})))}>Test connection</Button>
                        {g.source === "ADMIN" && (
                          <Button variant="outline" disabled={busy} onClick={() => {
                            if (!window.confirm(`Remove the ${LABEL[g.environment].toLowerCase()} keys saved here? Calls fall back to the server settings, or go without a gateway token.`)) return;
                            void act(async () => (await apiDelete(`/platform-admin/etims/gateways/${g.environment}`), "Keys removed."));
                          }}>Remove keys</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardContent className="space-y-3 py-4">
                <h2 className="font-semibold">Businesses with eTIMS ({businesses.length})</h2>
                <p className="text-xs text-secondary-500">
                  A business sets up its own PIN and branch devices under Money → KRA eTIMS. Open live eTIMS to a business only once KRA has certified ZARODA; the business then switches over itself and reconnects its devices with KRA&apos;s live details.
                </p>
                {businesses.length === 0 ? (
                  <p className="text-sm text-secondary-500">No business has set up eTIMS yet.</p>
                ) : (
                  <div className="space-y-3">
                    {businesses.map((b) => (
                      <div key={b.organizationId} className="space-y-2 rounded-md border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{b.name}</span>
                          <Badge variant={b.enabled ? "success" : "neutral"}>{b.enabled ? "On" : "Off"}</Badge>
                          <Badge variant={b.environment === "PRODUCTION" ? "warning" : "neutral"}>{LABEL[b.environment]}</Badge>
                          {b.sendSales && <Badge variant="success">Sending sales</Badge>}
                          {b.liveApprovedAt && <Badge variant="warning">Live allowed</Badge>}
                        </div>
                        <p className="text-xs text-secondary-500">PIN {b.tin ?? "not entered"}{b.taxpayerName ? ` · KRA name: ${b.taxpayerName}` : ""}</p>
                        <ul className="text-xs">
                          {b.devices.length === 0 ? <li className="text-secondary-500">No branch device connected yet.</li> : b.devices.map((d) => (
                            <li key={d.bhfId}>Branch {d.bhfId} ({d.branch}): {d.status === "ACTIVE" ? "connected" : d.status === "FAILED" ? "failed" : "not connected"}{d.lastError ? ` - ${d.lastError}` : ""}</li>
                          ))}
                        </ul>
                        <p className="text-xs">
                          Documents: {b.documents.sent} sent · {b.documents.pending} waiting · <span className={b.documents.rejected ? "text-error-600" : ""}>{b.documents.rejected} refused by KRA</span> · {b.documents.manual} need a person
                        </p>
                        {b.lastDocument && (
                          <p className="text-xs text-secondary-500">Last: {b.lastDocument.kind.toLowerCase()} {b.lastDocument.status.toLowerCase()} {when(b.lastDocument.updatedAt)}{b.lastDocument.lastError ? ` - ${b.lastDocument.lastError}` : ""}</p>
                        )}
                        {b.liveApprovedAt ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                            if (!window.confirm(`Withdraw live eTIMS from ${b.name}?`)) return;
                            void act(async () => (await apiDelete(`/platform-admin/etims/businesses/${b.organizationId}/live`), `Live eTIMS withdrawn from ${b.name}.`));
                          }}>Withdraw live</Button>
                        ) : (
                          <Button size="sm" disabled={busy} onClick={() => {
                            if (!window.confirm(`Allow ${b.name} to switch to live KRA eTIMS? Only do this once KRA has certified ZARODA.`)) return;
                            void act(async () => (await apiPost(`/platform-admin/etims/businesses/${b.organizationId}/live`, {}), `${b.name} can now switch to live eTIMS.`));
                          }}>Allow live</Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
