"use client";

import Link from "next/link";
import { KENYA_COUNTIES, PasswordInput } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeRole, setSession } from "../../../lib/auth";
import { RentalsFrame } from "../../../components/rentals/public-frame";
import { RENTALS_BRAND } from "../../../lib/rentals";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const field = "w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground";

/** Signing up here always creates a RENTAL business on the free Bure plan (up to 5 units). */
export default function RentalsSignup() {
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
          industryType: "RENTAL",
          branchName: "Main",
          ownerFullName: f.ownerFullName.trim(),
          ownerEmail: f.ownerEmail.trim(),
          ownerPassword: f.ownerPassword,
          county: f.county || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : Array.isArray(json.message) ? json.message.join(", ") : "Sign up failed");
      setSession({ apiBaseUrl, accessToken: json.accessToken, role: decodeRole(json.accessToken) ?? "OWNER", email: f.ownerEmail.trim(), industryType: "RENTAL", orgName: f.organizationName.trim() });
      router.replace("/rentals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RentalsFrame>
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-bold" style={{ color: RENTALS_BRAND.green }}>Start free</h1>
        <p className="mt-1 text-sm text-secondary-600">Free for up to 5 occupied units. No M-Pesa needed to start.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-sm">Your business or property name<input className={field} value={f.organizationName} onChange={set("organizationName")} required /></label>
          <label className="block text-sm">Your name<input className={field} value={f.ownerFullName} onChange={set("ownerFullName")} required /></label>
          <label className="block text-sm">Email<input type="email" className={field} value={f.ownerEmail} onChange={set("ownerEmail")} required /></label>
          <label className="block text-sm">Password (at least 8 characters)<PasswordInput className={field} value={f.ownerPassword} onChange={set("ownerPassword")} minLength={8} required /></label>
          <label className="block text-sm">County
            <select className={field} value={f.county} onChange={set("county")}>
              <option value="">Choose...</option>
              {KENYA_COUNTIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg p-3 font-semibold text-white disabled:opacity-50" style={{ background: RENTALS_BRAND.green }}>
            {busy ? "Setting up..." : "Create my account"}
          </button>
        </form>
        <Link href="/rentals/login" className="mt-4 block text-center text-sm" style={{ color: RENTALS_BRAND.navy }}>Already have an account? Sign in</Link>
      </main>
    </RentalsFrame>
  );
}
