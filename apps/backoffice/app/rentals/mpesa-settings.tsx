"use client";


import { PasswordInput } from "@zaroda/ui";
import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "../../lib/api";

export interface MpesaSettings {
  paymentGateway: "TUMA" | "DARAJA";
  tumaConnected: boolean;
  tumaEmail: string | null;
  mpesaConnected: boolean;
  mpesaAccountType: "PAYBILL" | "TILL" | null;
  mpesaShortcode: string | null;
  mpesaTillNumber: string | null;
  mpesaEnvironment: string;
  ready: boolean;
}

const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const smallButton = "rounded border border-border px-2 py-1 text-xs hover:bg-background disabled:opacity-50";

/**
 * Where the landlord's rent money lands when a tenant pays an M-Pesa prompt: their own Tuma account, or their own
 * Paybill/Till through Safaricom. The keys are checked with the provider before saving, stored encrypted, and are
 * never shown again.
 */
export function MpesaSettingsPanel({ onChange }: { onChange?: (s: MpesaSettings) => void }) {
  const [settings, setSettings] = useState<MpesaSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"TUMA" | "DARAJA">("TUMA");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tuma, setTuma] = useState({ email: "", apiKey: "" });
  const [daraja, setDaraja] = useState({ accountType: "PAYBILL", shortcode: "", tillNumber: "", consumerKey: "", consumerSecret: "", passkey: "", environment: "production" });

  function apply(s: MpesaSettings) {
    setSettings(s);
    setTab(s.paymentGateway);
    onChange?.(s);
  }

  useEffect(() => {
    apiGet<MpesaSettings>("/rental/mpesa/settings")
      .then(apply)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the M-Pesa settings."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<MpesaSettings>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
      after?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const connectTuma = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () => apiPost<MpesaSettings>("/rental/mpesa/tuma", { email: tuma.email.trim(), apiKey: tuma.apiKey.trim() }),
      () => setTuma({ email: "", apiKey: "" }),
    );
  };

  const connectDaraja = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        apiPost<MpesaSettings>("/rental/mpesa/daraja", {
          accountType: daraja.accountType,
          shortcode: daraja.shortcode.trim(),
          tillNumber: daraja.accountType === "TILL" ? daraja.tillNumber.trim() : undefined,
          consumerKey: daraja.consumerKey.trim(),
          consumerSecret: daraja.consumerSecret.trim(),
          passkey: daraja.passkey.trim(),
          environment: daraja.environment,
        }),
      () => setDaraja({ ...daraja, consumerKey: "", consumerSecret: "", passkey: "" }),
    );
  };

  const status = !settings
    ? "Loading..."
    : settings.ready
      ? `Connected: ${settings.paymentGateway === "DARAJA" ? `your own ${settings.mpesaAccountType === "TILL" ? "Till" : "Paybill"} ${settings.mpesaTillNumber ?? settings.mpesaShortcode}` : `Tuma (${settings.tumaEmail})`}`
      : "Not connected yet - you can still record payments by hand";

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Automatic M-Pesa</p>
          <p className={`text-xs ${settings?.ready ? "text-green-400" : "text-secondary-500"}`}>{status}</p>
        </div>
        <button className={smallButton} onClick={() => setOpen(!open)}>{open ? "Close" : settings?.ready ? "Change settings" : "Set up"}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-secondary-500">
            Tenants get an M-Pesa prompt on their phone and the rent is recorded the moment they pay. The money goes to YOUR account, never to Zaroda.
          </p>
          {error && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p>}
          <div className="flex gap-2">
            {(["TUMA", "DARAJA"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-primary-600 text-white" : "border border-border bg-surface"}`}>
                {t === "TUMA" ? "Tuma" : "My own Paybill / Till"}
                {settings && ((t === "TUMA" && settings.tumaConnected) || (t === "DARAJA" && settings.mpesaConnected)) ? " ✓" : ""}
              </button>
            ))}
          </div>

          {tab === "TUMA" && (
            <form onSubmit={connectTuma} className="grid gap-2 sm:grid-cols-3">
              <input className={input} type="email" required placeholder="Your Tuma account email" value={tuma.email} onChange={(e) => setTuma({ ...tuma, email: e.target.value })} />
              <PasswordInput className={input} required minLength={8} placeholder="Tuma API key" autoComplete="off" value={tuma.apiKey} onChange={(e) => setTuma({ ...tuma, apiKey: e.target.value })} />
              <button className={button} disabled={busy}>{settings?.tumaConnected ? "Replace Tuma details" : "Connect Tuma"}</button>
              {settings?.tumaConnected && (
                <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                  {settings.paymentGateway !== "TUMA" && (
                    <button type="button" className={smallButton} disabled={busy} onClick={() => void run(() => apiPost<MpesaSettings>("/rental/mpesa/gateway", { gateway: "TUMA" }))}>Use Tuma for rent</button>
                  )}
                  <button type="button" className={smallButton} disabled={busy} onClick={() => window.confirm("Disconnect Tuma?") && void run(() => apiDelete<MpesaSettings>("/rental/mpesa/tuma"))}>Disconnect</button>
                </div>
              )}
            </form>
          )}

          {tab === "DARAJA" && (
            <form onSubmit={connectDaraja} className="grid gap-2 sm:grid-cols-3">
              <select className={input} value={daraja.accountType} onChange={(e) => setDaraja({ ...daraja, accountType: e.target.value })}>
                <option value="PAYBILL">Paybill</option>
                <option value="TILL">Till (Buy Goods)</option>
              </select>
              <input className={input} required inputMode="numeric" placeholder={daraja.accountType === "TILL" ? "Store (head office) number" : "Paybill number"} value={daraja.shortcode} onChange={(e) => setDaraja({ ...daraja, shortcode: e.target.value })} />
              {daraja.accountType === "TILL" ? (
                <input className={input} required inputMode="numeric" placeholder="Till number" value={daraja.tillNumber} onChange={(e) => setDaraja({ ...daraja, tillNumber: e.target.value })} />
              ) : (
                <select className={input} value={daraja.environment} onChange={(e) => setDaraja({ ...daraja, environment: e.target.value })}>
                  <option value="production">Live</option>
                  <option value="sandbox">Safaricom test (sandbox)</option>
                </select>
              )}
              <PasswordInput className={input} required placeholder="Daraja consumer key" autoComplete="off" value={daraja.consumerKey} onChange={(e) => setDaraja({ ...daraja, consumerKey: e.target.value })} />
              <PasswordInput className={input} required placeholder="Daraja consumer secret" autoComplete="off" value={daraja.consumerSecret} onChange={(e) => setDaraja({ ...daraja, consumerSecret: e.target.value })} />
              <PasswordInput className={input} required placeholder="Lipa na M-Pesa passkey" autoComplete="off" value={daraja.passkey} onChange={(e) => setDaraja({ ...daraja, passkey: e.target.value })} />
              <button className={button} disabled={busy}>{settings?.mpesaConnected ? "Replace M-Pesa details" : "Connect my Paybill / Till"}</button>
              {settings?.mpesaConnected && (
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  {settings.paymentGateway !== "DARAJA" && (
                    <button type="button" className={smallButton} disabled={busy} onClick={() => void run(() => apiPost<MpesaSettings>("/rental/mpesa/gateway", { gateway: "DARAJA" }))}>Use my Paybill / Till for rent</button>
                  )}
                  <button type="button" className={smallButton} disabled={busy} onClick={() => window.confirm("Disconnect your Paybill / Till?") && void run(() => apiDelete<MpesaSettings>("/rental/mpesa/daraja"))}>Disconnect</button>
                </div>
              )}
              <p className="text-xs text-secondary-500 sm:col-span-3">
                The key, secret and passkey come from your Safaricom Daraja app. They are checked with Safaricom, then stored encrypted and never shown again.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
