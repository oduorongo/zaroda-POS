"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, getDeviceConfig, type CachedOrgUser } from "../../lib/db";
import { apiPost, ApiError, OfflineError } from "../../lib/api";
import { Button, ThemeToggle } from "@zaroda/ui";

interface PinLoginResponse {
  accessToken: string;
  cashierSessionId: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [cashiers, setCashiers] = useState<CachedOrgUser[]>([]);
  const [selected, setSelected] = useState<CachedOrgUser | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) {
        router.replace("/setup");
        return;
      }
      setTerminalId(config.terminalId);
      setCashiers(await db.orgUsers.toArray());
    })();
  }, [router]);

  function pressDigit(digit: string) {
    setError(null);
    if (pin.length < 8) setPin(pin + digit);
  }

  function backspace() {
    setError(null);
    setPin(pin.slice(0, -1));
  }

  async function submitPin() {
    if (!selected || !terminalId || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<PinLoginResponse>("/auth/pin-login", {
        terminalId,
        orgUserId: selected.id,
        pin,
      });
      await db.session.put({
        id: "session",
        cashierSessionId: result.cashierSessionId,
        orgUserId: selected.id,
        cashierName: selected.fullName,
        accessToken: result.accessToken,
        startedAt: new Date().toISOString(),
      });
      router.replace("/pos");
    } catch (err) {
      if (err instanceof OfflineError) {
        setError("No connection - PIN login needs the terminal to be online at least once per shift.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Wrong PIN - try again.");
      } else {
        setError("Login failed - try again.");
      }
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  if (!selected) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-background p-6 text-foreground">
        <div className="self-end">
          <ThemeToggle />
        </div>
        <h1 className="mt-4 text-2xl font-bold">Nani anauza? · Who&apos;s selling?</h1>
        <div className="mt-8 grid w-full max-w-sm grid-cols-2 gap-4">
          {cashiers.map((cashier) => (
            <button
              key={cashier.id}
              onClick={() => setSelected(cashier)}
              className="flex min-h-touch flex-col items-center gap-2 rounded-xl bg-surface p-6 text-center transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-xl font-bold">
                {cashier.fullName.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium">{cashier.fullName}</span>
              <span className="text-xs text-secondary-500">{cashier.role}</span>
            </button>
          ))}
          {cashiers.length === 0 && (
            <p className="col-span-2 text-center text-secondary-500">
              No cashiers cached yet - run terminal setup while online first.
            </p>
          )}
        </div>
        <p className="mt-auto pt-8 text-center text-xs text-secondary-600">
          Powered by Zaroda Solutions. Innovative. Reliable. Forward.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-background p-6 text-foreground">
      <button
        onClick={() => { setSelected(null); setPin(""); setError(null); }}
        className="min-h-touch self-start px-2 text-primary-400 hover:text-primary-300"
      >
        &larr; Back
      </button>

      <div className="mt-2 flex flex-col items-center text-center">
        {/* LOGO SLOT: replace this div with an <img src="/logo.svg" /> once a real mark exists */}
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-base font-bold text-white">
          Z
        </div>
        <span className="mt-1.5 text-xs font-bold tracking-tight text-secondary-600">
          Zaroda <span className="text-primary-400">POS</span>
        </span>
      </div>

      <p className="mt-4 text-secondary-500">{selected.fullName}</p>
      <h1 className="text-xl font-bold">Enter your PIN</h1>
      <p className="text-secondary-500">Tap your PIN to start your shift.</p>

      <div className="mt-6 flex gap-3" aria-hidden="true">
        {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 border-primary-400 ${i < pin.length ? "bg-primary-400" : "bg-transparent"}`}
          />
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-error-700/20 px-3 py-2 text-sm text-error-500" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            onClick={() => pressDigit(digit)}
            disabled={busy}
            className="h-touch rounded-xl bg-surface text-2xl font-semibold transition-colors hover:bg-border disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {digit}
          </button>
        ))}
        <button
          onClick={backspace}
          disabled={busy}
          aria-label="Backspace"
          className="h-touch rounded-xl bg-surface text-lg hover:bg-border disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          ⌫
        </button>
        <button
          onClick={() => pressDigit("0")}
          disabled={busy}
          className="h-touch rounded-xl bg-surface text-2xl font-semibold hover:bg-border disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          0
        </button>
        <Button
          onClick={submitPin}
          disabled={busy || pin.length < 4}
          variant="primary"
          size="touch"
          className="rounded-xl text-lg"
        >
          {busy ? "..." : "Go"}
        </Button>
      </div>
    </div>
  );
}
