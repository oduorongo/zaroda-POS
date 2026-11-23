"use client";

import { KENYA_COUNTIES, PasswordInput } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeRole, setSession } from "../../../lib/auth";
import { openApp } from "../../../lib/product";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND, inputClass } from "../../../lib/shamba";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/** Signing up here always creates a FARM business; the 14-day Farmer trial starts on first use. */
export default function ShambaSignup() {
  const router = useRouter();
  const [f, setF] = useState({ organizationName: "", ownerFullName: "", ownerEmail: "", ownerPassword: "", county: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: f.organizationName.trim(),
          industryType: "FARM",
          branchName: "Main farm",
          ownerFullName: f.ownerFullName.trim(),
          ownerEmail: f.ownerEmail.trim(),
          ownerPassword: f.ownerPassword,
          county: f.county || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : Array.isArray(json.message) ? json.message.join(", ") : "Sign up failed");
      setSession({ apiBaseUrl, accessToken: json.accessToken, role: decodeRole(json.accessToken) ?? "OWNER", email: f.ownerEmail.trim(), industryType: "FARM", orgName: f.organizationName.trim() });
      openApp("/shamba", json.accessToken, f.ownerEmail.trim(), (p) => router.replace(p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShambaPublicFrame>
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Start your free trial</h1>
        <p className="mt-1 text-sm text-secondary-600">14 days of the Farmer plan. No M-Pesa needed.</p>
        <form onSubmit={submit} className="mt-6 space-y-3 text-sm">
          <label className="block">
            Farm name
            <input className={inputClass} value={f.organizationName} onChange={set("organizationName")} placeholder="e.g. Uriri Dairy Farm" required />
          </label>
          <label className="block">
            Your name
            <input className={inputClass} value={f.ownerFullName} onChange={set("ownerFullName")} autoComplete="name" required />
          </label>
          <label className="block">
            Email
            <input type="email" className={inputClass} value={f.ownerEmail} onChange={set("ownerEmail")} autoComplete="email" required />
          </label>
          <label className="block">
            Password (at least 8 characters)
            <PasswordInput className={inputClass} value={f.ownerPassword} onChange={set("ownerPassword")} minLength={8} autoComplete="new-password" required />
          </label>
          <label className="block">
            County
            <select className={inputClass} value={f.county} onChange={set("county")}>
              <option value="">Choose...</option>
              {KENYA_COUNTIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg p-3 font-semibold text-white disabled:opacity-50" style={{ background: SHAMBA_BRAND.orange }}>
            {busy ? "Setting up your farm..." : "Create my farm"}
          </button>
        </form>
        <a href="/login" className="mt-4 block text-center text-sm" style={{ color: SHAMBA_BRAND.navy }}>
          Already have an account? Sign in
        </a>
      </main>
    </ShambaPublicFrame>
  );
}
