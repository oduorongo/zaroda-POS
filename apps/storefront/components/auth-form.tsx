"use client";


import { PasswordInput } from "@zaroda/ui";
import { useEffect, useState } from "react";
import { ApiError, buyerPinLogin, buyerSignup, getAuthMethods, requestBuyerPinReset, requestCode, resetBuyerPin, verifyCode, type LoginIdentity } from "../lib/api";
import { useStore } from "./store-provider";

type Mode = "email" | "phone";

/**
 * Sign in with a 6-digit code: enter your email, get the code, enter it. (Or your
 * phone number and an SMS code, offered only once the server has SMS set up.)
 * Creates the shopper account on first success - there's no separate sign-up.
 */
function CodeSignIn({ onDone, onBack }: { onDone?: () => void; onBack: () => void }) {
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
        <button type="button" onClick={onBack} className="w-full text-sm text-secondary-500 hover:underline">
          Back to phone number and PIN
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

type PinMode = "login" | "signup" | "forgot" | "reset" | "code";
const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
const primary = "w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const link = "w-full text-center text-sm text-primary-600 hover:underline";
const digits = (value: string, max: number) => value.replace(/\D/g, "").slice(0, max);

/**
 * Shopper sign-in. The main way is phone number + PIN: no email and no text message needed, so it works on every
 * network (texts only reach some numbers for now). Email or text codes are still there as "sign in with a code".
 */
export default function AuthForm({ onDone }: { onDone?: () => void }) {
  const { signIn } = useStore();
  const [mode, setMode] = useState<PinMode>("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const go = (next: PinMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setPin("");
    setCode("");
  };

  if (mode === "code") return <CodeSignIn onDone={onDone} onBack={() => go("login")} />;

  const phoneOk = phone.trim().length >= 9;
  const ready = mode === "login" ? phoneOk && pin.length >= 4 : mode === "signup" ? phoneOk && pin.length >= 4 : mode === "forgot" ? phoneOk : code.length === 6 && pin.length >= 4;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        const result = await requestBuyerPinReset(phone.trim());
        if (result.sent) {
          setInfo(result.message);
          setMode("reset");
        } else {
          setError(result.message);
        }
        return;
      }
      const result =
        mode === "login" ? await buyerPinLogin(phone.trim(), pin)
        : mode === "signup" ? await buyerSignup(phone.trim(), pin, name)
        : await resetBuyerPin(phone.trim(), code, pin);
      signIn(result.accessToken, result.buyer);
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = { login: "", signup: "Create your account", forgot: "Forgot your PIN?", reset: "Choose a new PIN" }[mode];
  const button = { login: "Sign in", signup: "Create account", forgot: "Send me a code", reset: "Save new PIN and sign in" }[mode];

  return (
    <form onSubmit={submit} className="space-y-4">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}

      {mode === "signup" && (
        <div>
          <label htmlFor="pa-name" className="block text-sm font-medium">
            Your name <span className="font-normal text-secondary-500">(optional)</span>
          </label>
          <input id="pa-name" maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
      )}

      <div>
        <label htmlFor="pa-phone" className="block text-sm font-medium">
          Your phone number
        </label>
        <input id="pa-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
      </div>

      {mode === "reset" && (
        <div>
          <label htmlFor="pa-code" className="block text-sm font-medium">
            The 6-digit code we sent you
          </label>
          <input id="pa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(digits(e.target.value, 6))} className={`${field} text-center text-2xl tracking-[0.4em]`} />
        </div>
      )}

      {mode !== "forgot" && (
        <div>
          <label htmlFor="pa-pin" className="block text-sm font-medium">
            {mode === "login" ? "Your PIN" : mode === "signup" ? "Choose a PIN (4 to 6 numbers)" : "New PIN (4 to 6 numbers)"}
          </label>
          <PasswordInput
            id="pa-pin"
            
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            maxLength={6}
            required
            value={pin}
            onChange={(e) => setPin(digits(e.target.value, 6))}
            className={`${field} text-center text-2xl tracking-[0.4em]`}
          />
          {mode === "signup" && <p className="mt-1 text-xs text-secondary-500">Remember it - you sign in with your phone number and this PIN. No email needed.</p>}
        </div>
      )}

      {info && <p className="text-sm text-success-600">{info}</p>}
      {error && <p className="text-sm text-error-600">{error}</p>}
      <button type="submit" disabled={busy || !ready} className={primary}>
        {busy ? "Please wait..." : button}
      </button>

      {mode === "login" && (
        <>
          <button type="button" onClick={() => go("forgot")} className={link}>
            Forgot your PIN?
          </button>
          <button type="button" onClick={() => go("signup")} className={link}>
            New here? Create an account
          </button>
          <button type="button" onClick={() => go("code")} className="w-full text-center text-xs text-secondary-500 hover:underline">
            Sign in with an email or text code instead
          </button>
        </>
      )}
      {mode !== "login" && (
        <button type="button" onClick={() => go("login")} className={link}>
          Back to sign in
        </button>
      )}
    </form>
  );
}
