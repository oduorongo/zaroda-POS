"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, LoadingState } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, teamPost, type TeamMe } from "../../../lib/team-api";

interface Rate {
  industryType: string;
  size: string;
  minKes: number;
  maxKes: number;
}
interface Fee {
  id: string;
  business: string;
  agent: string;
  agentId: string;
  size: string;
  amountKes: number;
  receiptNo: string;
  note: string | null;
  receivedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
interface Mine {
  rates: Rate[];
  notYetCharged: { id: string; name: string; industryType: string }[];
  fees: Fee[];
  thisMonthKes: number;
}

const SIZES = [
  { value: "SMALL", label: "Small (one shop, 1-2 people)" },
  { value: "MEDIUM", label: "Medium (a busy shop or a few staff)" },
  { value: "LARGE", label: "Large (several branches or many staff)" },
];
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const field = "w-full rounded-md border border-border bg-background p-2 text-sm";

function rangeFor(rates: Rate[], industryType: string, size: string) {
  return rates.find((r) => r.industryType === industryType && r.size === size) ?? rates.find((r) => r.industryType === "ANY" && r.size === size) ?? null;
}

function SetupFeesBody({ me }: { me: TeamMe }) {
  const [data, setData] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orgId, setOrgId] = useState("");
  const [size, setSize] = useState("SMALL");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isLeader = me.agent.role === "LEADER";

  const load = useCallback(async () => {
    try {
      setData(await teamGet<Mine>("/setup-fees"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load setup fees.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const org = data?.notYetCharged.find((o) => o.id === orgId) ?? null;
  const range = data && org ? rangeFor(data.rates, org.industryType, size) : null;
  const value = Number(amount);
  const inRange = range != null && amount.trim() !== "" && value >= range.minKes && value <= range.maxKes;

  async function record() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fee = await teamPost<Fee>("/setup-fees", { organizationId: orgId, size, amountKes: value, note: note.trim() || undefined });
      setNotice(`Recorded ${kes(fee.amountKes)} from ${fee.business}. Receipt number ${fee.receiptNo} - give it to the business.`);
      setOrgId("");
      setAmount("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the setup fee.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-bold">Setup fees</h1>
      <p className="text-sm text-secondary-500">
        When you set up a business, you may charge it a one-off setup fee in cash and keep it: it is yours, ZARODA takes nothing and does not pay it out. Pick the
        business&apos;s size; the fee must be within ZARODA&apos;s range for that size and type. Record it here as soon as you are paid and give the business the receipt
        number.
      </p>
      {error && <p className="text-sm text-error-600">{error}</p>}
      {notice && <p className="rounded-md border border-success-600/40 bg-success-50 p-3 text-sm">{notice}</p>}
      {!data && !error && <LoadingState label="Loading setup fees..." />}

      {data && (
        <>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-2xl font-bold">{kes(data.thisMonthKes)}</p>
            <p className="text-sm text-secondary-500">Setup fees you collected this month</p>
          </div>

          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Record a setup fee</h2>
            {data.notYetCharged.length === 0 ? (
              <p className="text-sm text-secondary-500">Every business you set up already has its setup fee recorded.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Business
                  <select className={field} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                    <option value="">Choose...</option>
                    {data.notYetCharged.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Size
                  <select className={field} value={size} onChange={(e) => setSize(e.target.value)}>
                    {SIZES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Amount received in cash (KES)
                  <input type="number" min={0} className={field} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  {org && (
                    <span className="text-xs text-secondary-500">
                      {range ? `Allowed: ${kes(range.minKes)} to ${kes(range.maxKes)}` : "No fee is set for this size yet - ask ZARODA."}
                    </span>
                  )}
                </label>
                <label className="text-sm">
                  Note (optional)
                  <input className={field} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. includes product upload" />
                </label>
                <div className="sm:col-span-2">
                  <button
                    onClick={() => void record()}
                    disabled={busy || !org || !inRange}
                    className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {busy ? "Saving..." : "Record setup fee"}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">{isLeader ? "Setup fees in your team" : "Your setup fees"}</h2>
            {data.fees.length === 0 ? (
              <EmptyState title="No setup fees yet" description="Setup fees you record appear here with their receipt numbers." />
            ) : (
              <ul className="space-y-2">
                {data.fees.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                    <div>
                      <p className="font-semibold">{f.business}</p>
                      <p className="text-secondary-500">
                        {f.receiptNo} · {f.size.toLowerCase()} · {new Date(f.receivedAt).toLocaleDateString("en-KE")}
                        {isLeader ? ` · ${f.agent}` : ""}
                        {f.voidedAt ? ` · voided: ${f.voidReason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${f.voidedAt ? "line-through opacity-60" : ""}`}>{kes(f.amountKes)}</span>
                      {f.voidedAt ? <Badge variant="warning">Voided</Badge> : <Badge variant="success">Cash kept</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function TeamSetupFeesPage() {
  return <TeamShell active="setup-fees">{(me) => <SetupFeesBody me={me} />}</TeamShell>;
}
