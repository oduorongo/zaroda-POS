"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "../../../lib/construction";
import { type PortalAccount, portalAccount, portalGet, setPortalAccount } from "../../../lib/con-portal";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../components/construction/ui";
import { PortalFrame } from "./portal-frame";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

interface Me { name: string; role: string; organization: { name: string; phone: string | null; email: string | null }; projects: { id: string; code: string; name: string; status: string; location: string | null; county: string | null }[] }

export default function PortalHome() {
  const [account, setAccount] = useState<PortalAccount | null | undefined>(undefined);
  useEffect(() => setAccount(portalAccount()), []);
  return <PortalFrame>{account === undefined ? null : account ? <Projects onSignOut={() => setAccount(null)} /> : <SignIn onIn={setAccount} />}</PortalFrame>;
}

function SignIn({ onIn }: { onIn: (a: PortalAccount) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "pick">("email");
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${apiBaseUrl}/construction-portal/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(Array.isArray(json.message) ? json.message.join(", ") : (json.message ?? "That did not work."));
    return json as T;
  };

  const choose = (a: PortalAccount) => {
    setPortalAccount(a);
    onIn(a);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "email") {
        const r = await post<{ sent: boolean; devCode?: string }>("request-code", { email: email.trim() });
        setDevCode(r.devCode ?? null);
        setStep("code");
      } else {
        const r = await post<{ accounts: PortalAccount[] }>("verify", { email: email.trim(), code: code.trim() });
        if (r.accounts.length === 1) choose(r.accounts[0]);
        else {
          setAccounts(r.accounts);
          setStep("pick");
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "pick")
    return (
      <Panel title="Which builder?">
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.token}>
              <button type="button" onClick={() => choose(a)} className="w-full rounded-lg border border-border p-3 text-left text-sm">
                <strong>{a.organization}</strong> <span className="text-secondary-500">as {a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    );

  return (
    <div className="mx-auto max-w-sm pt-6">
      <Panel title="Sign in to follow your project">
        <form onSubmit={submit} className="space-y-3">
          <ErrorBox message={error} />
          <Field label="Your email">
            <input type="email" required className={inputClass} value={email} disabled={step === "code"} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {step === "code" && (
            <>
              <p className="text-sm">If the builder invited this email, we have sent it a 6-digit code.</p>
              {devCode && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Test mode (email not set up): your code is {devCode}</p>}
              <Field label="Code">
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={inputClass} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </>
          )}
          <PrimaryButton type="submit" disabled={busy || (step === "code" && code.length !== 6)}>{step === "email" ? "Email me a code" : "Sign in"}</PrimaryButton>
          {step === "code" && <button type="button" className="ml-3 text-sm underline" onClick={() => { setStep("email"); setCode(""); }}>Use another email</button>}
        </form>
      </Panel>
      <p className="mt-3 text-center text-xs text-secondary-500">No password: a new code is emailed each time you sign in.</p>
    </div>
  );
}

function Projects({ onSignOut }: { onSignOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    portalGet<Me>("/me")
      .then(setMe)
      .catch((e) => {
        if (!portalAccount()) onSignOut();
        else setError(errorText(e, (e as Error).message));
      });
  }, [onSignOut]);
  if (error) return <ErrorBox message={error} />;
  if (!me) return <p className="text-sm">Loading...</p>;
  return (
    <Panel title={`Your projects with ${me.organization.name}`}>
      {me.projects.length === 0 ? (
        <p className="text-sm text-secondary-500">No projects have been shared with you yet.</p>
      ) : (
        <ul className="space-y-2">
          {me.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/construction/portal/${p.id}`} className="block rounded-lg border border-border p-3 no-underline">
                <strong>{p.code} · {p.name}</strong>
                <span className="block text-xs text-secondary-500">{[p.location, p.county].filter(Boolean).join(", ")} · {p.status.replace(/_/g, " ").toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-secondary-500">Questions? {me.organization.name}{me.organization.phone ? ` · ${me.organization.phone}` : ""}{me.organization.email ? ` · ${me.organization.email}` : ""}</p>
    </Panel>
  );
}
