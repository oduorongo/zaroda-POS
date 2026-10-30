"use client";

import Link from "next/link";
import { PasswordInput } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getOrganization, login } from "../../../lib/api";
import { clearSession, decodeRole, setSession } from "../../../lib/auth";
import { CON_BRAND, CON_LOGIN_ROLES } from "../../../lib/construction";
import { posUrl } from "../../../lib/product";
import { PublicFrame } from "../../../components/construction/public-frame";
import { inputClass } from "../../../components/construction/ui";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export default function ConstructionLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConstruction, setNotConstruction] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotConstruction(false);
    try {
      const { accessToken } = await login(apiBaseUrl, email.trim(), password);
      const role = decodeRole(accessToken) ?? "UNKNOWN";
      const org = (await getOrganization(apiBaseUrl, accessToken)) as { industryType: string; name?: string };
      if (org.industryType !== "CONSTRUCTION") {
        clearSession();
        setNotConstruction(true);
        return;
      }
      if (!CON_LOGIN_ROLES.includes(role)) {
        clearSession();
        setError("Your account cannot sign in here. Ask your director to change your access.");
        return;
      }
      setSession({ apiBaseUrl, accessToken, role, email: email.trim(), industryType: org.industryType, orgName: org.name });
      router.replace("/construction");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed - try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicFrame>
      <main className="mx-auto flex max-w-sm flex-col gap-5 px-4 py-12">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: CON_BRAND.navy }}>Sign in</h1>
          <p className="text-sm text-secondary-500">Zaroda Build, for contractors.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input type="email" className={inputClass} placeholder="you@company.co.ke" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <PasswordInput className={inputClass} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {notConstruction && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This account is not a construction business. <a href={posUrl("/login")} className="font-semibold underline">Sign in to the Zaroda back office</a> instead.
            </p>
          )}
          <button type="submit" disabled={busy} className="w-full rounded-lg p-3 font-semibold text-white disabled:opacity-50" style={{ background: CON_BRAND.navy }}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <Link href="/construction/signup" className="text-center text-sm" style={{ color: CON_BRAND.orange }}>New here? Start a 14-day free trial</Link>
      </main>
    </PublicFrame>
  );
}
