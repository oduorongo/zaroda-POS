"use client";

import { useEffect, useState } from "react";
import { ApiError, getAuthMethods, requestCode, verifyCode, type LoginIdentity } from "../lib/api";
import { useStore } from "./store-provider";

type Mode = "email" | "phone";

/**
 * Sign in with a 6-digit code: enter your email, get the code, enter it. (Or your
 * phone number and an SMS code, offered only once the server has SMS set up.)
 * Creates the shopper account on first success - there's no separate sign-up.
 */
export default function AuthForm({ onDone }: { onDone?: () => void }) {
  const { signIn } = useStore();
  const [mode, setMode] = useState<Mode>("email");
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [step, setStep] = useState<"identify" | "code">("identify");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownIdentifier, setShownIdentifier] = useState("");

  useEffect(() => {
    // If this fails we just stay with email, which always works.
    getAuthMethods()
      .then((m) => setSmsAvailable(m.sms))
      .catch(() => undefined);
  }, []);

  const identity = (): LoginIdentity => (mode === "email" ? { email: value.trim() } : { phone: value.trim() });
  const reset = () => {
    setStep("identify");
    setCode("");
    setError(null);
  };

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestCode(identity());
      setShownIdentifier(result.channel === "SMS" ? result.identifier.replace(/^254/, "0") : result.identifier);
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
      const result = await verifyCode(identity(), code.trim());
      signIn(result.accessToken, result.buyer);
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "identify") {
    return (
      <form onSubmit={sendCode} className="space-y-4">
        <div>
          <label htmlFor="identity" className="block text-sm font-medium">
            {mode === "email" ? "Your email address" : "Your phone number"}
          </label>
          <input
            id="identity"
            type={mode === "email" ? "email" : "tel"}
            inputMode={mode === "email" ? "email" : "tel"}
            autoComplete={mode === "email" ? "email" : "tel"}
            required
            placeholder={mode === "email" ? "you@example.com" : "0712 345 678"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base"
          />
          <p className="mt-1 text-xs text-secondary-500">
            We&apos;ll {mode === "email" ? "email" : "text"} you a 6-digit code. No password needed.
          </p>
        </div>
        {error && <p className="text-sm text-error-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send code"}
        </button>
        {smsAvailable && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === "email" ? "phone" : "email");
              setValue("");
              setError(null);
            }}
            className="w-full text-sm text-primary-600 hover:underline"
          >
            {mode === "email" ? "Use my phone number instead" : "Use my email address instead"}
          </button>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium">
          Enter the 6-digit code we {mode === "email" ? "emailed" : "texted"} to {shownIdentifier}
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-center text-2xl tracking-[0.5em]"
        />
        {mode === "email" && <p className="mt-1 text-xs text-secondary-500">Can&apos;t see it? Check your spam or promotions folder.</p>}
      </div>
      {error && <p className="text-sm text-error-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? "Checking..." : "Verify and continue"}
      </button>
      <button type="button" onClick={reset} className="w-full text-sm text-primary-600 hover:underline">
        {mode === "email" ? "Use a different email address" : "Use a different number"}
      </button>
    </form>
  );
}
