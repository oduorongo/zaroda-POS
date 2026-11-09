"use client";

import { useEffect, useState } from "react";
import { Button } from "@zaroda/ui";
import { ApiError } from "../lib/api";

export interface TrainingAccount {
  industryType: string;
  label: string;
  businessName: string;
  ownerEmail: string;
  organizationId: string;
  passwordSetAt: string;
  signInUrl: string | null;
  password?: string;
}

interface Props {
  load: () => Promise<TrainingAccount[]>;
  /** Platform admin only: create the training businesses this team is missing. */
  create?: () => Promise<{ accounts: TrainingAccount[]; failed: string[] }>;
  /** Platform admin and team leader: a new password, shown once. */
  reset?: (industryType: string) => Promise<{ password: string }>;
  /** Passwords handed over from the create-team screen, shown once (sessionStorage key, removed after reading). */
  handoverKey?: string;
}

/** A team's training businesses (sample data, one shared owner login each). Passwords show once, when made or reset. */
export function TrainingAccounts({ load, create, reset, handoverKey }: Props) {
  const [rows, setRows] = useState<TrainingAccount[] | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (handoverKey) {
      try {
        const raw = sessionStorage.getItem(handoverKey);
        sessionStorage.removeItem(handoverKey);
        if (raw) {
          setShown(JSON.parse(raw) as Record<string, string>);
          setNote("Training accounts were created with the team. Copy the passwords now - they are not shown again.");
        }
      } catch {}
    }
    load()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the training accounts."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keep = (accounts: TrainingAccount[]) =>
    setShown((s) => ({ ...s, ...Object.fromEntries(accounts.filter((a) => a.password).map((a) => [a.industryType, a.password!])) }));

  async function makeThem() {
    if (!create) return;
    setBusy("create");
    setError(null);
    setNote(null);
    try {
      const res = await create();
      keep(res.accounts);
      setRows(res.accounts);
      setNote(res.failed.length ? `Could not create: ${res.failed.join(", ")}. Try again.` : "Training accounts are ready. Copy the passwords now - they are not shown again.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the training accounts.");
    } finally {
      setBusy(null);
    }
  }

  async function newPassword(type: string) {
    if (!reset) return;
    setBusy(type);
    setError(null);
    try {
      const { password } = await reset(type);
      setShown((s) => ({ ...s, [type]: password }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password.");
    } finally {
      setBusy(null);
    }
  }

  const missing = rows !== null && rows.length < 8;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Training accounts</h2>
        {create && missing && (
          <Button size="sm" onClick={makeThem} disabled={busy !== null}>
            {busy === "create" ? "Creating… (about 10 seconds)" : rows?.length ? "Create the missing ones" : "Create training accounts"}
          </Button>
        )}
      </div>
      <p className="text-sm text-secondary-500">
        Practice businesses with sample products, customers and sales, one for each business type. The whole team shares these logins. They are never billed and earn no commission.
      </p>
      {error && <p className="text-sm text-error-600">{error}</p>}
      {note && <p className="text-sm text-secondary-700">{note}</p>}
      {rows === null && !error && <p className="text-sm text-secondary-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-secondary-500">{create ? "None yet." : "None yet - ask the platform owner to create them."}</p>}
      {!!rows?.length && (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.industryType} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">{a.label}</p>
                <p className="text-secondary-500">{a.businessName}</p>
                <p className="break-all font-mono text-xs">{a.ownerEmail}</p>
                {shown[a.industryType] && (
                  <p className="font-mono text-xs">
                    Password: <span className="rounded bg-secondary-100 px-1.5 py-0.5 font-semibold text-secondary-900">{shown[a.industryType]}</span>
                  </p>
                )}
                {a.signInUrl && (
                  <a href={a.signInUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                    Sign in at {a.signInUrl.replace(/^https:\/\//, "").replace(/\/login$/, "")}
                  </a>
                )}
              </div>
              {reset && (
                <Button size="sm" variant="secondary" onClick={() => newPassword(a.industryType)} disabled={busy !== null}>
                  {busy === a.industryType ? "Resetting…" : "New password"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
