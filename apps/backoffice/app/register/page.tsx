"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../lib/api";
import { setSession, decodeRole } from "../../lib/auth";

interface RegisterResponse {
  accessToken: string;
  organizationId: string;
  orgUserId: string;
  branchId: string;
  terminalId: string;
}

const INDUSTRY_TYPES = [
  { value: "RETAIL", label: "Retail" },
  { value: "RESTAURANT", label: "Restaurant" },
  { value: "PHARMACY", label: "Pharmacy" },
  { value: "SALON", label: "Salon" },
];

/**
 * The tenant-onboarding entry point - POST /auth/register creates a
 * brand new Organization + OWNER User + first Branch + first Terminal in
 * one call. No API-base-URL field like /login has: registering only
 * makes sense against a real deployment, not something worth pointing at
 * an arbitrary URL the way logging into an already-known org is.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3001");
  const [organizationName, setOrganizationName] = useState("");
  const [industryType, setIndustryType] = useState("RETAIL");
  const [branchName, setBranchName] = useState("Main");
  const [terminalLabel, setTerminalLabel] = useState("Register 1");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl.trim().replace(/\/+$/, "")}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          industryType,
          branchName: branchName.trim(),
          terminalLabel: terminalLabel.trim() || undefined,
          ownerFullName: ownerFullName.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerPassword,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiError(typeof json.message === "string" ? json.message : "Registration failed", response.status);
      }
      const data = json as RegisterResponse;
      setResult(data);
      const role = decodeRole(data.accessToken) ?? "OWNER";
      setSession({ apiBaseUrl: apiBaseUrl.trim(), accessToken: data.accessToken, role, email: ownerEmail.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
        <div className="w-full max-w-lg space-y-4 rounded-xl bg-slate-800 p-6 shadow-xl">
          <h1 className="text-2xl font-bold text-green-400">Organization created</h1>
          <p className="text-sm text-slate-400">
            Save these IDs - the terminal PWA&apos;s setup screen and any additional back-office device will need
            them. You&apos;re already signed in here.
          </p>
          <dl className="space-y-2 rounded-md bg-slate-900 p-4 text-sm">
            <Row label="Organization ID" value={result.organizationId} />
            <Row label="Branch ID" value={result.branchId} />
            <Row label="Terminal ID" value={result.terminalId} />
          </dl>
          <button
            onClick={() => router.push("/sales")}
            className="w-full rounded-md bg-blue-600 p-3 font-semibold hover:bg-blue-500"
          >
            Continue to Back Office
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Set up a new organization</h1>
        <p className="text-sm text-slate-400">
          Creates your organization, its first branch and terminal, and your owner account in one step.
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-300">API base URL</label>
          <input
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Business name</label>
          <input
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Industry</label>
          <select
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={industryType}
            onChange={(e) => setIndustryType(e.target.value)}
          >
            {INDUSTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-300">First branch name</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">First terminal name</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
              value={terminalLabel}
              onChange={(e) => setTerminalLabel(e.target.value)}
            />
          </div>
        </div>
        <hr className="border-slate-700" />
        <div>
          <label className="block text-sm font-medium text-slate-300">Your name</label>
          <input
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={ownerFullName}
            onChange={(e) => setOwnerFullName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Your email</label>
          <input
            type="email"
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Password (min 8 characters)</label>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-blue-600 p-3 text-lg font-semibold hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create organization"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="w-full text-center text-sm text-blue-400 hover:underline"
        >
          Already have an organization? Log in
        </button>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}
