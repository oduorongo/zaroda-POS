"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getTenantMe,
  getTenantPrompt,
  getTenantReceipt,
  getTenantStatement,
  getTenantSignInMethods,
  requestTenantCode,
  tenantPay,
  tenantReportProblem,
  verifyTenantCode,
  type TenantLease,
  type TenantMe,
  type TenantReceipt,
  type TenantStatement,
  type TenantTenancy,
} from "../lib/api";

const TOKEN_KEY = "zaroda_tenant_token";

// Browser storage can be unavailable (private windows, blocked site data) - the page then just asks you to sign in each visit.
const readToken = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
};

const money = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);
const nice = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", MPESA: "M-Pesa", TUMA: "M-Pesa", DARAJA: "M-Pesa", OTHER: "Other" };

const inputClass = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
const primaryButton = "rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const smallButton = "rounded border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50";

/** The tenant's own account: sign in by emailed code, see the balance, pay by M-Pesa, get receipts, report a problem. */
export default function TenantPortal() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<TenantMe | null>(null);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
    setMe(null);
  }, []);

  const refresh = useCallback(
    async (tok: string) => {
      try {
        setMe(await getTenantMe(tok));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) signOut();
        else throw err;
      }
    },
    [signOut],
  );

  useEffect(() => {
    const saved = readToken();
    if (!saved) {
      setReady(true);
      return;
    }
    getTenantMe(saved)
      .then((result) => {
        setToken(saved);
        setMe(result);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) writeToken(null);
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;

  if (!token || !me) {
    return (
      <SignIn
        onSignedIn={(accessToken) => {
          writeToken(accessToken);
          setToken(accessToken);
          getTenantMe(accessToken).then(setMe).catch(() => undefined);
        }}
      />
    );
  }

  return <Home token={token} me={me} onRefresh={() => refresh(token)} onSignOut={signOut} />;
}

// ── Sign in ───────────────────────────────────────────────────────────────

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [step, setStep] = useState<"start" | "code">("start");
  // Text message is offered only when the server has it set up.
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTenantSignInMethods()
      .then((m) => setSmsAvailable(m.sms))
      .catch(() => {});
  }, []);

  const identity = method === "email" ? { email: email.trim() } : { phone: phone.trim() };
  const target = method === "email" ? email.trim() : phone.trim();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestTenantCode(identity);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifyTenantCode(identity, code.trim());
      onSignedIn(result.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-2xl font-bold">My rent account</h1>
        <p className="mt-1 text-secondary-500">See what you owe, pay by M-Pesa, get your receipts and tell your landlord about anything that needs fixing.</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-6">
        {step === "start" ? (
          <form onSubmit={send} className="space-y-4">
            {smsAvailable && (
              <div className="flex gap-2 text-sm">
                {(["email", "phone"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMethod(m);
                      setError(null);
                    }}
                    className={`rounded-md px-3 py-1.5 ${method === m ? "bg-primary-600 text-white" : "border border-border"}`}
                  >
                    {m === "email" ? "Email me a code" : "Text me a code"}
                  </button>
                ))}
              </div>
            )}
            {method === "email" ? (
              <div>
                <label htmlFor="tenant-email" className="block text-sm font-medium">
                  The email address your landlord has for you
                </label>
                <input id="tenant-email" type="email" inputMode="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                <p className="mt-1 text-xs text-secondary-500">We&apos;ll email you a 6-digit code. No password needed. If you have not got an account yet, ask your landlord to add your email address.</p>
              </div>
            ) : (
              <div>
                <label htmlFor="tenant-phone" className="block text-sm font-medium">
                  The mobile number your landlord has for you
                </label>
                <input id="tenant-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
                <p className="mt-1 text-xs text-secondary-500">We&apos;ll text you a 6-digit code. No password needed. If you have not got an account yet, ask your landlord to add your number.</p>
              </div>
            )}
            {error && <p className="text-sm text-error-600">{error}</p>}
            <button type="submit" disabled={busy || !target} className={`w-full ${primaryButton}`}>
              {busy ? "Sending..." : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div>
              <label htmlFor="tenant-code" className="block text-sm font-medium">
                Enter the 6-digit code we {method === "email" ? "emailed" : "texted"} to {target}
              </label>
              <input
                id="tenant-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
              />
              <p className="mt-1 text-xs text-secondary-500">
                {method === "email" ? "No email? Check spam or promotions. " : "No text yet? Give it a minute. "}A code is only sent if your landlord has this exact {method === "email" ? "address" : "number"} on file.
              </p>
            </div>
            {error && <p className="text-sm text-error-600">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className={`w-full ${primaryButton}`}>
              {busy ? "Checking..." : "Verify and continue"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("start");
                setCode("");
                setError(null);
              }}
              className="w-full text-sm text-primary-600 hover:underline"
            >
              Use {method === "email" ? "a different email address" : "a different number"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────

type Document = { kind: "receipt"; data: TenantReceipt } | { kind: "statement"; data: TenantStatement };

function Home({ token, me, onRefresh, onSignOut }: { token: string; me: TenantMe; onRefresh: () => Promise<void>; onSignOut: () => void }) {
  const [document, setDocument] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(load: () => Promise<Document>) {
    setError(null);
    try {
      setDocument(await load());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that document.");
    }
  }

  if (document) return <PrintableDocument doc={document} onClose={() => setDocument(null)} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">My rent account</h1>
          <p className="text-sm text-secondary-500">{me.email ?? me.phone}</p>
        </div>
        <button className={smallButton} onClick={onSignOut}>Sign out</button>
      </div>
      {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
      {me.tenancies.length === 0 && <p className="text-secondary-500">Nothing to show yet.</p>}
      {me.tenancies.map((t, i) => (
        <Tenancy
          key={i}
          token={token}
          tenancy={t}
          onRefresh={onRefresh}
          onReceipt={(paymentId) => open(async () => ({ kind: "receipt", data: await getTenantReceipt(token, paymentId) }))}
          onStatement={(leaseId) => open(async () => ({ kind: "statement", data: await getTenantStatement(token, leaseId) }))}
        />
      ))}
    </div>
  );
}

function Tenancy({
  token,
  tenancy,
  onRefresh,
  onReceipt,
  onStatement,
}: {
  token: string;
  tenancy: TenantTenancy;
  onRefresh: () => Promise<void>;
  onReceipt: (paymentId: string) => void;
  onStatement: (leaseId: string) => void;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        {tenancy.business}
        <span className="ml-2 text-sm font-normal text-secondary-500">tenant: {tenancy.tenantName}</span>
      </h2>
      {tenancy.leases.map((lease) => (
        <LeaseCard key={lease.leaseId} token={token} tenancy={tenancy} lease={lease} onRefresh={onRefresh} onReceipt={onReceipt} onStatement={onStatement} />
      ))}
      <Maintenance tenancy={tenancy} token={token} onRefresh={onRefresh} />
    </section>
  );
}

function LeaseCard({
  token,
  tenancy,
  lease,
  onRefresh,
  onReceipt,
  onStatement,
}: {
  token: string;
  tenancy: TenantTenancy;
  lease: TenantLease;
  onRefresh: () => Promise<void>;
  onReceipt: (paymentId: string) => void;
  onStatement: (leaseId: string) => void;
}) {
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptId, setPromptId] = useState<string | null>(lease.pendingPrompt?.id ?? null);
  const [result, setResult] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  // While the M-Pesa prompt is open on the tenant's phone, follow it until it is paid or fails.
  useEffect(() => {
    if (!promptId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const status = await getTenantPrompt(token, promptId);
        if (cancelled || status.status === "PENDING") return;
        clearInterval(timer);
        setPromptId(null);
        if (status.status === "PAID") {
          setResult({ tone: "ok", text: `Payment of KES ${money(status.amount)} received. Thank you!${status.mpesaReceipt ? ` M-Pesa ${status.mpesaReceipt}.` : ""}` });
          await onRefresh();
        } else if (status.status === "REVIEW") {
          setResult({ tone: "bad", text: "Your payment was received but needs your landlord to check it. Please contact them." });
        } else {
          setResult({ tone: "bad", text: status.lastError ?? "The M-Pesa payment did not go through. You can try again." });
        }
      } catch {
        /* keep trying */
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [promptId, token, onRefresh]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const prompt = await tenantPay(token, { leaseId: lease.leaseId, amount: Number(amount), phone: phone.trim() || undefined });
      if (prompt.status === "FAILED") {
        setError(prompt.lastError ?? "The M-Pesa prompt could not be sent.");
      } else {
        setPromptId(prompt.id);
        setPaying(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the payment.");
    } finally {
      setBusy(false);
    }
  }

  const active = lease.status === "ACTIVE";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {lease.property.name} - {lease.unit}
          </p>
          <p className="text-xs text-secondary-500">
            {lease.property.address ? `${lease.property.address} · ` : ""}Rent KES {money(lease.monthlyRent)} a month, due on the {lease.dueDay}
            {lease.dueDay === 1 ? "st" : lease.dueDay === 2 ? "nd" : lease.dueDay === 3 ? "rd" : "th"}
            {!active && lease.endedAt ? ` · ended ${day(lease.endedAt)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-secondary-500">{lease.outstanding > 0 ? "You owe" : lease.credit > 0 ? "In credit" : "Balance"}</p>
          <p className={`text-2xl font-bold ${lease.overdue > 0 ? "text-error-600" : lease.outstanding === 0 ? "text-green-600" : ""}`}>
            KES {money(lease.outstanding > 0 ? lease.outstanding : lease.credit)}
          </p>
          {lease.overdue > 0 && <p className="text-xs text-error-600">KES {money(lease.overdue)} overdue</p>}
          {lease.outstanding === 0 && lease.credit === 0 && <p className="text-xs text-green-600">Paid up</p>}
        </div>
      </div>

      {result && <p className={`mt-3 rounded-md p-3 text-sm ${result.tone === "ok" ? "bg-green-50 text-green-900" : "bg-error-50 text-error-900"}`}>{result.text}</p>}

      {promptId && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Check your phone: enter your M-Pesa PIN to finish paying. This page updates by itself once it goes through.
        </p>
      )}

      {active && lease.outstanding > 0 && !promptId && (
        <div className="mt-3">
          {!paying ? (
            <div className="space-y-2">
              {tenancy.canPayByMpesa ? (
                <button
                  className={primaryButton}
                  onClick={() => {
                    setPaying(true);
                    setAmount(String(lease.outstanding));
                    setResult(null);
                  }}
                >
                  Pay by M-Pesa
                </button>
              ) : (
                <p className="text-sm text-secondary-500">Your landlord has not set up M-Pesa payments in the app yet.</p>
              )}
              {tenancy.paymentInstructions && (
                <p className="text-sm">
                  <span className="font-medium">How to pay your landlord directly:</span> {tenancy.paymentInstructions}
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={pay} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className="text-xs text-secondary-500">Amount (KES)</label>
                <input className={inputClass} type="number" min="1" max={lease.outstanding} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-secondary-500">M-Pesa phone (leave blank to use the one on file)</label>
                <input className={inputClass} inputMode="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
                <button className={primaryButton} disabled={busy}>
                  {busy ? "Sending..." : "Send prompt"}
                </button>
                <button type="button" className={smallButton} onClick={() => setPaying(false)}>
                  Cancel
                </button>
              </div>
              {error && <p className="text-sm text-error-600 sm:col-span-3">{error}</p>}
            </form>
          )}
        </div>
      )}

      {lease.openInvoices.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">What is unpaid</p>
          {lease.openInvoices.map((inv) => (
            <p key={inv.id} className="flex justify-between border-t border-border py-1 text-sm">
              <span>
                {inv.description} <span className="text-xs text-secondary-500">due {day(inv.dueDate)}</span>
                {inv.status === "OVERDUE" && <span className="ml-1 text-xs font-semibold text-error-600">overdue</span>}
              </span>
              <span>KES {money(inv.balance)}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-medium">Payments you have made</p>
          <button className={smallButton} onClick={() => onStatement(lease.leaseId)}>
            Statement
          </button>
        </div>
        {lease.payments.length === 0 && <p className="text-sm text-secondary-500">No payments yet.</p>}
        {lease.payments.map((p) => (
          <p key={p.id} className="flex items-center justify-between gap-2 border-t border-border py-1 text-sm">
            <span>
              {day(p.paidAt)} · {METHOD_LABEL[p.method] ?? p.method} · <span className="text-xs text-secondary-500">{p.receiptNumber}</span>
            </span>
            <span className="flex items-center gap-2">
              KES {money(p.amount)}
              <button className={smallButton} onClick={() => onReceipt(p.id)}>
                Receipt
              </button>
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Reporting a problem ───────────────────────────────────────────────────

function Maintenance({ token, tenancy, onRefresh }: { token: string; tenancy: TenantTenancy; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [leaseId, setLeaseId] = useState(tenancy.leases.find((l) => l.status === "ACTIVE")?.leaseId ?? tenancy.leases[0]?.leaseId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await tenantReportProblem(token, { leaseId, title: title.trim(), description: description.trim() || undefined });
      setTitle("");
      setDescription("");
      setSent(true);
      setOpen(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Something needs fixing?</p>
        {!open && (
          <button className={smallButton} onClick={() => setOpen(true)}>
            Tell my landlord
          </button>
        )}
      </div>
      {sent && <p className="mt-2 rounded-md bg-green-50 p-2 text-sm text-green-900">Sent. Your landlord can see it now.</p>}
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          {tenancy.leases.length > 1 && (
            <select className={inputClass} value={leaseId} onChange={(e) => setLeaseId(e.target.value)}>
              {tenancy.leases.map((l) => (
                <option key={l.leaseId} value={l.leaseId}>
                  {l.property.name} - {l.unit}
                </option>
              ))}
            </select>
          )}
          <input className={inputClass} required minLength={2} maxLength={150} placeholder="What is the problem? (e.g. Leaking tap)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={inputClass} rows={3} maxLength={1500} placeholder="More detail (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="text-sm text-error-600">{error}</p>}
          <div className="flex gap-2">
            <button className={primaryButton} disabled={busy}>
              {busy ? "Sending..." : "Send"}
            </button>
            <button type="button" className={smallButton} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {tenancy.maintenance.length > 0 && (
        <div className="mt-3">
          {tenancy.maintenance.map((m) => (
            <p key={m.id} className="flex justify-between border-t border-border py-1 text-sm">
              <span>
                {m.title} <span className="text-xs text-secondary-500">{day(m.reportedAt)}</span>
              </span>
              <span className={m.status === "DONE" ? "text-green-600" : "text-secondary-500"}>{nice(m.status)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Receipt / statement, laid out for the printer ─────────────────────────

function PrintableDocument({ doc, onClose }: { doc: Document; onClose: () => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      {/* The site header and bottom bar are for screens; the printed page carries its own Zaroda footer. */}
      <style>{`@media print { body > header, body > footer, .no-print { display: none !important; } main { padding: 0 !important; min-height: 0 !important; } @page { margin: 12mm; } }`}</style>
      <div className="no-print mb-4 flex gap-2">
        <button className={primaryButton} onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <button className={smallButton} onClick={onClose}>
          Back
        </button>
      </div>
      <div className="rounded border border-gray-400 bg-white p-6 text-black">
        {doc.kind === "receipt" ? (
          <>
            <h1 className="text-xl font-bold">{doc.data.business}</h1>
            <p className="text-sm text-gray-600">Rent receipt</p>
            {doc.data.voided && <p className="my-2 rounded bg-red-100 p-2 text-sm font-bold text-red-800">VOID</p>}
            <table className="mt-4 w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-gray-600">Receipt no.</td><td className="py-1 font-semibold">{doc.data.receiptNumber}</td></tr>
                <tr><td className="py-1 text-gray-600">Date</td><td className="py-1">{day(doc.data.paidAt)}</td></tr>
                <tr><td className="py-1 text-gray-600">Received from</td><td className="py-1">{doc.data.tenant.name}</td></tr>
                <tr><td className="py-1 text-gray-600">Property</td><td className="py-1">{doc.data.property.name} - {doc.data.unit}</td></tr>
                <tr><td className="py-1 text-gray-600">Paid by</td><td className="py-1">{METHOD_LABEL[doc.data.method] ?? doc.data.method}{doc.data.reference ? ` (${doc.data.reference})` : ""}</td></tr>
                <tr><td className="py-1 text-gray-600">Amount</td><td className="py-1 text-lg font-bold">KES {money(doc.data.amount)}</td></tr>
              </tbody>
            </table>
            {doc.data.appliedTo.length > 0 && (
              <div className="mt-4 text-sm">
                <p className="font-semibold">Paid towards</p>
                {doc.data.appliedTo.map((a, i) => (
                  <p key={i} className="flex justify-between border-b border-gray-200 py-1">
                    <span>{a.description}</span>
                    <span>KES {money(a.amount)}</span>
                  </p>
                ))}
              </div>
            )}
            {doc.data.keptAsCredit > 0 && <p className="mt-2 text-sm">Kept as credit for future rent: KES {money(doc.data.keptAsCredit)}</p>}
            <p className="mt-4 text-sm">
              Balance still owing after this payment: <strong>KES {money(doc.data.balanceAfter)}</strong>
            </p>
            <Footer note="This is a computer-generated receipt." />
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{doc.data.business}</h1>
            <p className="text-sm text-gray-600">Tenant statement as at {day(doc.data.printedOn)}</p>
            <p className="mt-3 text-sm">
              <strong>{doc.data.tenant.name}</strong> - {doc.data.property.name}, {doc.data.unit}
              <br />
              Rent KES {money(doc.data.monthlyRent)} per month, since {day(doc.data.startDate)}
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-400 text-left text-xs uppercase text-gray-600">
                  <th className="py-1">Date</th>
                  <th className="py-1">Details</th>
                  <th className="py-1 text-right">Charged</th>
                  <th className="py-1 text-right">Paid</th>
                  <th className="py-1 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {doc.data.lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="py-1">{day(l.date)}</td>
                    <td className="py-1">
                      {l.description}
                      {l.reference ? ` (${l.reference})` : ""}
                    </td>
                    <td className="py-1 text-right">{l.charge ? money(l.charge) : ""}</td>
                    <td className="py-1 text-right">{l.paid ? money(l.paid) : ""}</td>
                    <td className="py-1 text-right">{money(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-right text-base font-bold">
              {doc.data.balance > 0 ? `Balance owing: KES ${money(doc.data.balance)}` : doc.data.balance < 0 ? `In credit: KES ${money(-doc.data.balance)}` : "Fully paid up"}
            </p>
            <Footer note="This is a computer-generated statement." />
          </>
        )}
      </div>
    </div>
  );
}

/** The footer every printed Zaroda document carries. */
function Footer({ note }: { note: string }) {
  return (
    <div className="mt-8 border-t border-gray-300 pt-3 text-center text-[10px] italic text-gray-500">
      <p className="not-italic">{note}</p>
      <p>Powered by ZARODA SOLUTIONS</p>
      <p>Reliable. Innovative. Forward.</p>
    </div>
  );
}
