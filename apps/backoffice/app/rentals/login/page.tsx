"use client";

import Link from "next/link";
import { PasswordInput } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getOrganization, login } from "../../../lib/api";
import { clearSession, decodeRole, homePath, isBackofficeRole, isCaretaker, setSession } from "../../../lib/auth";
import { posUrl } from "../../../lib/product";
import { RentalsFrame } from "../../../components/rentals/public-frame";
import { RENTALS_BRAND } from "../../../lib/rentals";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const field = "w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground";

/** Sign in to ZARODA RENTALS: landlords (owners, managers) and their caretakers. Any other business is sent to the POS back office. */
export default function RentalsLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notRentals, setNotRentals] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotRentals(false);
    try {
      const { accessToken } = await login(apiBaseUrl, email.trim(), password);
      const role = decodeRole(accessToken) ?? "UNKNOWN";
      const org = (await getOrganization(apiBaseUrl, accessToken)) as { industryType: string; name?: string };
      if (org.industryType !== "RENTAL") {
        clearSession();
        setNotRentals(true);
        return;
      }
      if (!isBackofficeRole(role) && !isCaretaker(role)) {
        clearSession();
        setError("Your account cannot sign in here. Ask the landlord to change your access.");
        return;
      }
      setSession({ apiBaseUrl, accessToken, role, email: email.trim(), industryType: org.industryType, orgName: org.name });
      router.replace(homePath(role, org.industryType));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed - try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RentalsFrame>
      <main className="mx-auto flex max-w-sm flex-col gap-5 px-4 py-12">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--con-ink)" }}>Sign in</h1>
          <p className="text-sm text-secondary-500">{RENTALS_BRAND.name}, for landlords and caretakers.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input type="email" className={field} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <PasswordInput className={field} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {notRentals && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This account is not a rentals business. <a href={posUrl("/login")} className="font-semibold underline">Sign in to the Zaroda back office</a> instead.
            </p>
          )}
          <button type="submit" disabled={busy} className="w-full rounded-lg p-3 font-semibold text-white disabled:opacity-50" style={{ background: RENTALS_BRAND.navy }}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <Link href="/rentals/signup" className="text-center text-sm" style={{ color: "var(--con-ink)" }}>New here? Start free</Link>
      </main>
    </RentalsFrame>
  );
}
