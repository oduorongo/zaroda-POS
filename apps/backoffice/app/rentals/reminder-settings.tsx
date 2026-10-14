"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "../../lib/api";

interface ReminderSettings {
  remindersEnabled: boolean;
  smsReminders: boolean;
  paymentInstructions: string;
  emailAvailable: boolean;
  smsAvailable: boolean;
}

const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const smallButton = "rounded border border-border px-2 py-1 text-xs hover:bg-background disabled:opacity-50";

/** Switches automatic rent reminders on and sets how tenants are told to pay. */
export function ReminderSettingsPanel() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<ReminderSettings>("/rental/reminders/settings")
      .then((s) => {
        setSettings(s);
        setInstructions(s.paymentInstructions);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load reminder settings."));
  }, []);

  async function save(change: Partial<Pick<ReminderSettings, "remindersEnabled" | "smsReminders" | "paymentInstructions">>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await apiPatch<ReminderSettings>("/rental/reminders/settings", change);
      setSettings(s);
      setInstructions(s.paymentInstructions);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Rent reminders</p>
          <p className={`text-xs ${settings?.remindersEnabled ? "text-green-400" : "text-secondary-500"}`}>
            {settings?.remindersEnabled ? "On - tenants are reminded before and after the due date" : "Off - switch on to remind tenants automatically"}
          </p>
        </div>
        <button className={smallButton} onClick={() => setOpen(!open)}>{open ? "Close" : "Set up"}</button>
      </div>
      {open && settings && (
        <div className="mt-3 space-y-3 text-sm">
          {error && <p className="rounded-md bg-red-950 p-2 text-red-300">{error}</p>}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.remindersEnabled} disabled={busy} onChange={(e) => void save({ remindersEnabled: e.target.checked })} />
            Send reminders automatically (3 days before, on the due date, 3 days late and 10 days late)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.smsReminders} disabled={busy || !settings.smsAvailable} onChange={(e) => void save({ smsReminders: e.target.checked })} />
            Also send an SMS {!settings.smsAvailable && <span className="text-xs text-secondary-500">(SMS is not set up on this server yet)</span>}
          </label>
          {!settings.emailAvailable && <p className="text-xs text-amber-400">Email sending is not set up on this server yet, so no reminders can go out.</p>}
          <p className="text-xs text-secondary-500">Reminders go to the email address on each tenant&apos;s record, so add emails on the Tenants tab. They are only sent between 8am and 8pm.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input className={input} maxLength={300} placeholder="How tenants should pay, e.g. Paybill 123456, account = your unit number" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            <button className={button} disabled={busy} onClick={() => void save({ paymentInstructions: instructions })}>Save</button>
          </div>
          {saved && <p className="text-xs text-green-400">Saved.</p>}
        </div>
      )}
    </div>
  );
}
