"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, getOrganization, ApiError } from "../../lib/api";
import { setSession, decodeRole } from "../../lib/auth";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await login(apiBaseUrl, email.trim(), password);
      const role = decodeRole(accessToken) ?? "UNKNOWN";
      const { industryType } = await getOrganization(apiBaseUrl, accessToken);
      setSession({ apiBaseUrl, accessToken, role, email: email.trim(), industryType });
      router.replace("/sales");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Hero panel — hidden on mobile, brand + tagline on desktop */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-12 lg:bg-gradient-to-br lg:from-slate-900 lg:via-slate-900 lg:to-blue-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.25),transparent_55%)]" />
        <div className="relative flex items-center gap-3">
          {/* LOGO SLOT: replace this div with an <img src="/logo.svg" /> once a real mark exists */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">
            Z
          </div>
          <span className="text-xl font-bold tracking-tight">
            Zaroda <span className="text-blue-400">POS</span>
          </span>
        </div>
        <div className="relative">
          <h2 className="text-3xl font-bold leading-tight text-white">
            Run your Kenyan shop with confidence
          </h2>
          <p className="mt-3 max-w-sm text-sm text-slate-400">
            Sales, stock, staff, and reporting for your whole business — in one back office built for
            Kenyan retail.
          </p>
        </div>
        <p className="relative text-xs text-slate-600">© {new Date().getFullYear()} Zaroda POS</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            {/* LOGO SLOT: replace this div with an <img src="/logo.svg" /> once a real mark exists */}
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white">
              Z
            </div>
            <span className="text-lg font-bold tracking-tight">
              Zaroda <span className="text-blue-400">POS</span>
            </span>
          </div>

          <div className="text-center lg:text-left">
            <h1 className="text-2xl font-bold text-white">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-400">Sign in to your Zaroda back office.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourshop.co.ke"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Password</label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 p-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/register")}
            className="w-full text-center text-sm text-slate-400 hover:text-blue-400 hover:underline"
          >
            New here? Set up your organization
          </button>
        </form>
      </div>
    </div>
  );
}
