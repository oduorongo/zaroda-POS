"use client";

import { FloatingThemeToggle, PasswordInput } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, getOrganization, ApiError } from "../../lib/api";
import { setSession, clearSession, decodeRole, homePath, isBackofficeRole, isCaretaker } from "../../lib/auth";
import { constructionUrl, currentProduct, hasConstructionDomain } from "../../lib/product";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const TERMINAL_URL = process.env.NEXT_PUBLIC_TERMINAL_URL ?? "https://pos.zarodashop.com";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedCashier, setBlockedCashier] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBlockedCashier(false);
    try {
      const { accessToken } = await login(apiBaseUrl, email.trim(), password);
      const role = decodeRole(accessToken) ?? "UNKNOWN";

      // The back office is for owners/managers/auditors only - a cashier
      // never gets a session here, they belong at the till (PIN login).
      if (!isBackofficeRole(role) && !isCaretaker(role)) {
        clearSession();
        setBlockedCashier(true);
        return;
      }

      const { industryType } = await getOrganization(apiBaseUrl, accessToken);
      // Construction has its own site and sessions are per site, so they sign in again there.
      if (industryType === "CONSTRUCTION" && hasConstructionDomain() && currentProduct() === "POS") {
        clearSession();
        window.location.href = constructionUrl("/construction/login");
        return;
      }
      setSession({ apiBaseUrl, accessToken, role, email: email.trim(), industryType });
      router.replace(homePath(role, industryType));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      <FloatingThemeToggle />
      {/* Hero panel — a compact banner on mobile, a full-height side panel
          from lg up. Background photo: apps/backoffice/public/login-hero.png
          (glossy-navy POS hardware shot). Falls back to the plain navy
          gradient underneath if that file is ever removed. */}
      <div
        className="relative flex min-h-[320px] flex-col justify-between overflow-hidden bg-cover bg-center p-6 sm:min-h-[380px] sm:p-8 lg:min-h-screen lg:w-1/2 lg:p-12 lg:bg-gradient-to-br lg:from-slate-900 lg:via-slate-900 lg:to-primary-900"
        style={{ backgroundImage: "url(/login-hero.png)" }}
      >
        {/* Navy overlay - keeps the wordmark/heading/copy readable over any photo */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-950/75 to-primary-900/85" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.25),transparent_55%)]" />
        <div className="relative flex items-center gap-4">
          {/* The transparent white logo sits straight on the photo; the old boxed blue logo looked pasted on. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zaroda-logo-white.png" alt="Zaroda Solutions" width={147} height={120} className="h-20 w-auto drop-shadow-lg sm:h-24 lg:h-28" />
          <span className="h-12 w-px bg-white/30 sm:h-14" aria-hidden="true" />
          <span className="text-sm font-extrabold uppercase tracking-widest text-[#c99a2e] sm:text-base">Back Office</span>
        </div>
        <div className="relative">
          <h2 className="text-2xl font-bold leading-tight text-white sm:text-3xl">
            Let Zarodashop help you run your hustle like a Pro.
          </h2>
          <p className="mt-3 max-w-sm text-sm text-secondary-300">
            Purchases, sales, stock, staff and reports for your business in one back office designed for
            the Kenyan Hustles.
          </p>
        </div>
        <p className="relative text-xs text-secondary-400">
          © {new Date().getFullYear()} Zaroda POS · Powered by Zaroda Solutions. Innovative. Reliable. Forward.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
          <div className="text-center lg:text-left">
            <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-secondary-500">Sign in to your Zaroda back office.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary-600">Email</label>
              <input
                type="email"
                className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-secondary-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourshop.co.ke"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary-600">Password</label>
              <PasswordInput
                
                className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-secondary-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
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

          {blockedCashier && (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/40 px-3 py-2.5 text-sm text-amber-200">
              <p>Cashiers sign in at the till, not here. Open pos.zarodashop.com and tap your PIN.</p>
              <a href={TERMINAL_URL} className="mt-1.5 inline-block font-semibold text-amber-100 hover:underline">
                Go to the till →
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary-600 p-3 font-semibold text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/register")}
            className="w-full text-center text-sm text-secondary-500 hover:text-primary-400 hover:underline"
          >
            New here? Set up your organization
          </button>
          <a href={constructionUrl("/construction/signup")} className="block text-center text-sm text-secondary-500 hover:underline">
            Construction contractor? Use Zaroda Build
          </a>
        </form>
      </div>
    </div>
  );
}
