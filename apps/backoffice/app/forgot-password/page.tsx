"use client";

import { FloatingThemeToggle, PasswordInput } from "@zaroda/ui";
import Link from "next/link";
import { useState } from "react";
import { publicPost, ApiError } from "../../lib/api";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const field =
  "w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-secondary-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40";

/** Forgot password: a 6-digit code goes to the account's email, then the person chooses a new password here. */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await publicPost<{ message: string }>(apiBaseUrl, "/auth/forgot-password", { email: email.trim() });
      setInfo(r.message);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach Zaroda - check your internet and try again");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords are not the same");
    setBusy(true);
    setError(null);
    try {
      await publicPost(apiBaseUrl, "/auth/reset-password", { email: email.trim(), code: code.trim(), newPassword: password });
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach Zaroda - check your internet and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <FloatingThemeToggle />
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-1 text-sm text-secondary-500">
            {step === "email" && "Enter the email you sign in with. We will email you a 6-digit code."}
            {step === "code" && info}
            {step === "done" && "Your password has been changed. Sign in with the new one."}
          </p>
        </div>

        {step === "email" && (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary-600">Email</label>
              <input type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshop.co.ke" required autoFocus />
            </div>
            {error && <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary-600 p-3 font-semibold text-white hover:bg-primary-500 disabled:opacity-50">
              {busy ? "Sending..." : "Email me a code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={reset} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary-600">6-digit code from the email</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className={`${field} text-center text-lg tracking-[0.4em]`}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary-600">New password (at least 8 characters)</label>
              <PasswordInput className={field} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary-600">New password again</label>
              <PasswordInput className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required autoComplete="new-password" />
            </div>
            {error && <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-lg bg-primary-600 p-3 font-semibold text-white hover:bg-primary-500 disabled:opacity-50">
              {busy ? "Saving..." : "Save new password"}
            </button>
            <button type="button" disabled={busy} onClick={() => void sendCode()} className="w-full text-center text-sm text-secondary-500 hover:underline">
              No email? Send a new code
            </button>
          </form>
        )}

        {step === "done" && (
          <Link href="/login" className="block w-full rounded-lg bg-primary-600 p-3 text-center font-semibold text-white no-underline hover:bg-primary-500">
            Go to sign in
          </Link>
        )}

        {step !== "done" && (
          <p className="text-center text-sm text-secondary-500">
            Remembered it? <Link href="/login" className="hover:underline">Back to sign in</Link>
          </p>
        )}
        <p className="text-center text-xs text-secondary-500">
          No longer have that email? Ask your business owner to set a new password for you under Staff, or WhatsApp Zaroda on +254 781 230 805.
        </p>
      </div>
    </div>
  );
}
