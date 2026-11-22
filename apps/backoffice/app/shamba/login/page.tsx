"use client";

import Link from "next/link";
import { PasswordInput } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getOrganization, login } from "../../../lib/api";
import { clearSession, decodeRole, setSession } from "../../../lib/auth";
import { posUrl } from "../../../lib/product";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND, inputClass } from "../../../lib/shamba";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const SIGN_IN_ROLES = ["OWNER", "MANAGER", "SUPERVISOR", "AUDITOR"];

export default function ShambaLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFarm, setNotFarm] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotFarm(false);
    try {
      const { accessToken } = await login(apiBaseUrl, email.trim(), password);
      const role = decodeRole(accessToken) ?? "UNKNOWN";
      const org = (await getOrganization(apiBaseUrl, accessToken)) as { industryType: string; name?: string };
      if (org.industryType !== "FARM") {
        clearSession();
        setNotFarm(true);
        return;
      }
      if (!SIGN_IN_ROLES.includes(role)) {
        clearSession();
        setError("Your account cannot sign in here. Ask the farm owner to change your access.");
        return;
      }
      setSession({ apiBaseUrl, accessToken, role, email: email.trim(), industryType: org.industryType, orgName: org.name });
      router.replace("/shamba");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed - try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShambaPublicFrame>
      <main className="mx-auto flex w-full max-w-sm flex-col gap-5 px-4 py-12">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Sign in</h1>
          <p className="text-sm text-secondary-500">Zaroda Shamba, for farms.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input type="email" className={inputClass} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <PasswordInput className={inputClass} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {notFarm && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This account is not a farm.{" "}
              <a href={posUrl("/login")} className="font-semibold underline">
                Sign in to the Zaroda back office
              </a>{" "}
              instead.
            </p>
          )}
          <button type="submit" disabled={busy} className="w-full rounded-lg p-3 font-semibold text-white disabled:opacity-50" style={{ background: SHAMBA_BRAND.navy }}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <Link href="/shamba/signup" className="text-center text-sm" style={{ color: SHAMBA_BRAND.orange }}>
          New here? Start a 14-day free trial
        </Link>
      </main>
    </ShambaPublicFrame>
  );
}
