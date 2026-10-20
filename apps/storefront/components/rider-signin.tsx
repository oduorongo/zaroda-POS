"use client";

import { useState } from "react";
import { ApiError, requestRiderCode, requestRiderPinReset, resetRiderPin, riderPinLogin, riderSignup, verifyRiderCode } from "../lib/api";
import type { Rider } from "../lib/types";

type Mode = "login" | "signup" | "forgot" | "reset" | "email" | "emailCode";

const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
const primary = "w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const link = "w-full text-center text-sm text-primary-600 hover:underline";
const digits = (value: string, max: number) => value.replace(/\D/g, "").slice(0, max);

const HEADING: Record<Mode, string> = {
  login: "Sign in",
  signup: "Create your rider account",
  forgot: "Forgot your PIN?",
  reset: "Choose a new PIN",
  email: "Sign in with email",
  emailCode: "Enter your code",
};
const BUTTON: Record<Mode, string> = {
  login: "Sign in",
  signup: "Create account",
  forgot: "Text me a code",
  reset: "Save new PIN and sign in",
  email: "Send code",
  emailCode: "Verify and continue",
};

/**
 * Rider sign-in. The main way is phone number + PIN: it needs no email and no text message, so it works on
 * every network (texts only reach some numbers for now). Email codes stay for riders who already use them.
 */
export default function RiderSignIn({ onSignedIn }: { onSignedIn: (token: string, rider: Rider) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setPin("");
    setCode("");
  };

  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === "login") {
        const r = await riderPinLogin(phone.trim(), pin);
        onSignedIn(r.accessToken, r.rider);
      } else if (mode === "signup") {
        const r = await riderSignup(name.trim(), phone.trim(), pin);
        onSignedIn(r.accessToken, r.rider);
      } else if (mode === "forgot") {
        const r = await requestRiderPinReset(phone.trim());
        if (r.sent) {
          setInfo(r.message);
          setMode("reset");
        } else {
          setError(r.message);
        }
      } else if (mode === "reset") {
        const r = await resetRiderPin(phone.trim(), code, pin);
        onSignedIn(r.accessToken, r.rider);
      } else if (mode === "email") {
        await requestRiderCode(email.trim());
        setMode("emailCode");
        setCode("");
      } else {
        const r = await verifyRiderCode(email.trim(), code.trim());
        onSignedIn(r.accessToken, r.rider);
      }
    }, "Something went wrong. Please try again.");
  };

  const phoneOk = phone.trim().length >= 9;
  const ready =
    mode === "login" ? phoneOk && pin.length >= 4
    : mode === "signup" ? name.trim().length >= 2 && phoneOk && pin.length >= 4
    : mode === "forgot" ? phoneOk
    : mode === "reset" ? code.length === 6 && pin.length >= 4
    : mode === "email" ? email.trim().length > 3
    : code.length === 6;

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Deliver with Zaroda</h1>
        <p className="mt-1 text-secondary-500">Riders with a boda boda, tuk tuk or vehicle can deliver orders for local shops. All you need is your phone number.</p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">{HEADING[mode]}</h2>

        {mode === "signup" && (
          <div>
            <label htmlFor="rs-name" className="block text-sm font-medium">
              Your full name
            </label>
            <input id="rs-name" required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
        )}

        {(mode === "login" || mode === "signup" || mode === "forgot" || mode === "reset") && (
          <div>
            <label htmlFor="rs-phone" className="block text-sm font-medium">
              Your phone number
            </label>
            <input id="rs-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
          </div>
        )}

        {mode === "reset" && (
          <div>
            <label htmlFor="rs-code" className="block text-sm font-medium">
              The 6-digit code we texted you
            </label>
            <input id="rs-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(digits(e.target.value, 6))} className={`${field} text-center text-2xl tracking-[0.4em]`} />
          </div>
        )}

        {(mode === "login" || mode === "signup" || mode === "reset") && (
          <div>
            <label htmlFor="rs-pin" className="block text-sm font-medium">
              {mode === "login" ? "Your PIN" : mode === "signup" ? "Choose a PIN (4 to 6 numbers)" : "New PIN (4 to 6 numbers)"}
            </label>
            <input
              id="rs-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={6}
              required
              value={pin}
              onChange={(e) => setPin(digits(e.target.value, 6))}
              className={`${field} text-center text-2xl tracking-[0.4em]`}
            />
            {mode === "signup" && <p className="mt-1 text-xs text-secondary-500">Remember it. You use your phone number and this PIN to sign in.</p>}
          </div>
        )}

        {mode === "email" && (
          <div>
            <label htmlFor="rs-email" className="block text-sm font-medium">
              Your email address
            </label>
            <input id="rs-email" type="email" inputMode="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            <p className="mt-1 text-xs text-secondary-500">We&apos;ll email you a 6-digit code.</p>
          </div>
        )}

        {mode === "emailCode" && (
          <div>
            <label htmlFor="rs-ecode" className="block text-sm font-medium">
              The 6-digit code we emailed to {email.trim()}
            </label>
            <input id="rs-ecode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(digits(e.target.value, 6))} className={`${field} text-center text-2xl tracking-[0.4em]`} />
            <p className="mt-1 text-xs text-secondary-500">Can&apos;t see it? Check your spam or promotions folder.</p>
          </div>
        )}

        {info && <p className="text-sm text-success-600">{info}</p>}
        {error && <p className="text-sm text-error-600">{error}</p>}
        <button type="submit" disabled={busy || !ready} className={primary}>
          {busy ? "Please wait..." : BUTTON[mode]}
        </button>

        {mode === "login" && (
          <>
            <button type="button" onClick={() => go("forgot")} className={link}>
              Forgot your PIN?
            </button>
            <button type="button" onClick={() => go("signup")} className={link}>
              New rider? Create an account
            </button>
            <button type="button" onClick={() => go("email")} className="w-full text-center text-xs text-secondary-500 hover:underline">
              Sign in with email instead
            </button>
          </>
        )}
        {mode !== "login" && (
          <button type="button" onClick={() => go("login")} className={link}>
            Back to sign in
          </button>
        )}
        {mode === "forgot" && <p className="text-xs text-secondary-500">If we can&apos;t text your number, the shop that added you (or Zaroda) can give you a new PIN.</p>}
      </form>
    </div>
  );
}
