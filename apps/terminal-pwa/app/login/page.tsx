"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, getDeviceConfig, type CachedOrgUser } from "../../lib/db";
import { apiPost, ApiError, OfflineError } from "../../lib/api";

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
      <div className="flex min-h-screen flex-col items-center bg-slate-900 p-6 text-slate-100">
        <h1 className="mt-8 text-2xl font-bold">Who&apos;s selling?</h1>
        <div className="mt-8 grid w-full max-w-sm grid-cols-2 gap-4">
          {cashiers.map((cashier) => (
            <button
              key={cashier.id}
              onClick={() => setSelected(cashier)}
              className="flex flex-col items-center gap-2 rounded-xl bg-slate-800 p-6 text-center hover:bg-slate-700"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-xl font-bold">
                {cashier.fullName.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium">{cashier.fullName}</span>
              <span className="text-xs text-slate-400">{cashier.role}</span>
            </button>
          ))}
          {cashiers.length === 0 && (
            <p className="col-span-2 text-center text-slate-400">
              No cashiers cached yet - run terminal setup while online first.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-900 p-6 text-slate-100">
      <button onClick={() => { setSelected(null); setPin(""); setError(null); }} className="self-start text-blue-400">
        &larr; Back
      </button>
      <h1 className="mt-4 text-xl font-bold">{selected.fullName}</h1>
      <p className="text-slate-400">Enter your PIN</p>

      <div className="mt-6 flex gap-3">
        {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 border-blue-400 ${i < pin.length ? "bg-blue-400" : "bg-transparent"}`}
          />
        ))}
      </div>

      {error && <p className="mt-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="mt-8 grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            onClick={() => pressDigit(digit)}
            disabled={busy}
            className="rounded-xl bg-slate-800 py-4 text-2xl font-semibold hover:bg-slate-700 disabled:opacity-50"
          >
            {digit}
          </button>
        ))}
        <button onClick={backspace} disabled={busy} className="rounded-xl bg-slate-800 py-4 text-lg hover:bg-slate-700 disabled:opacity-50">
          ⌫
        </button>
        <button onClick={() => pressDigit("0")} disabled={busy} className="rounded-xl bg-slate-800 py-4 text-2xl font-semibold hover:bg-slate-700 disabled:opacity-50">
          0
        </button>
        <button
          onClick={submitPin}
          disabled={busy || pin.length < 4}
          className="rounded-xl bg-blue-600 py-4 text-lg font-semibold hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "..." : "Go"}
        </button>
      </div>
    </div>
  );
}
