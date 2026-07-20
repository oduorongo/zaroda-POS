"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, ApiError } from "../../lib/api";
import { setSession, decodeRole } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3001");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await login(apiBaseUrl.trim(), email.trim(), password);
      const role = decodeRole(accessToken) ?? "UNKNOWN";
      setSession({ apiBaseUrl: apiBaseUrl.trim(), accessToken, role, email: email.trim() });
      router.replace("/sales");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Back Office</h1>
        <p className="text-sm text-slate-400">
          Full email/password login (not the terminal&apos;s PIN switch) - this console is for owners, managers, and
          auditors reviewing sales and managing the catalog.
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
          <label className="block text-sm font-medium text-slate-300">Email</label>
          <input
            type="email"
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-blue-600 p-3 font-semibold hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/register")}
          className="w-full text-center text-sm text-blue-400 hover:underline"
        >
          New here? Set up your organization
        </button>
      </form>
    </div>
  );
}
