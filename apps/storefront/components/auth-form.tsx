"use client";

import { useState } from "react";
import { ApiError, requestCode, verifyCode } from "../lib/api";
import { useStore } from "./store-provider";

/**
 * Phone-number login: enter your number, get a 6-digit SMS code, enter it.
 * Creates the buyer account on first success - there's no separate sign-up.
 */
export default function AuthForm({ onDone }: { onDone?: () => void }) {
  const { signIn } = useStore();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestCode(phone.trim());
      setPhone(result.phone);
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
      const result = await verifyCode(phone, code.trim());
      signIn(result.accessToken, result.buyer);
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium">
            Your phone number
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-base"
          />
          <p className="mt-1 text-xs text-secondary-500">We&apos;ll text you a 6-digit code. No password needed.</p>
        </div>
        {error && <p className="text-sm text-error-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !phone.trim()}
          className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium">
          Enter the 6-digit code we sent to {phone.replace(/^254/, "0")}
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
      </div>
      {error && <p className="text-sm text-error-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? "Checking..." : "Verify and continue"}
      </button>
      <button
        type="button"
        onClick={() => {
          setStep("phone");
          setCode("");
          setError(null);
        }}
        className="w-full text-sm text-primary-600 hover:underline"
      >
        Use a different number
      </button>
    </form>
  );
}
