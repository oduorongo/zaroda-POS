"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../lib/db";
import { apiPost, apiGet, ApiError } from "../../lib/api";

interface LoginResponse {
  accessToken: string;
}

interface OrgUserResponse {
  id: string;
  role: string;
  user: { fullName: string };
}

interface TaxClassResponse {
  rate: string;
  isExempt: boolean;
}

interface VariantResponse {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  price: string;
  quantityMode: "COUNT" | "WEIGHT";
}

interface ProductResponse {
  id: string;
  name: string;
  taxClass: TaxClassResponse | null;
  variants: VariantResponse[];
}

interface OrganizationResponse {
  industryType: string;
}

interface BranchResponse {
  id: string;
  name: string;
}

interface TerminalResponse {
  id: string;
  branchId: string;
  deviceLabel: string;
}

/**
 * First-run device provisioning, in two steps now that GET /branches and
 * GET /terminals exist: a manager logs in first (step 1), then picks the
 * branch/terminal from real dropdowns fed by those endpoints (step 2) -
 * previously this asked for both raw UUIDs upfront, pasted in from the
 * API/seed output directly, since neither endpoint existed yet. That
 * one-time manager login still means the terminal never needs those
 * credentials again after this screen - it switches to PIN-based cashier
 * login from here on (DESIGN.md §9).
 */
export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3001");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [terminals, setTerminals] = useState<TerminalResponse[]>([]);
  const [branchId, setBranchId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { accessToken: token } = await apiPost<LoginResponse>("/auth/login", { email, password }, undefined, apiBaseUrl.trim());
      const [branchList, terminalList] = await Promise.all([
        apiGet<BranchResponse[]>("/branches", token, apiBaseUrl.trim()),
        apiGet<TerminalResponse[]>("/terminals", token, apiBaseUrl.trim()),
      ]);
      if (branchList.length === 0) {
        setError("This organization has no branches yet - create one in the back office first.");
        return;
      }
      setAccessToken(token);
      setBranches(branchList);
      setTerminals(terminalList);
      setBranchId(branchList[0].id);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  const terminalsForBranch = terminals.filter((t) => t.branchId === branchId);

  async function handleFinish(event: React.FormEvent) {
    event.preventDefault();
    if (!terminalId) return;
    setError(null);
    setBusy(true);
    try {
      const org = await apiGet<OrganizationResponse>("/organizations/me", accessToken, apiBaseUrl.trim());

      await db.deviceConfig.put({
        id: "device",
        apiBaseUrl: apiBaseUrl.trim(),
        branchId,
        terminalId,
        branchName: branches.find((b) => b.id === branchId)?.name ?? "",
        terminalLabel: terminals.find((t) => t.id === terminalId)?.deviceLabel ?? "",
        orgUsersCachedAt: null,
        catalogCachedAt: null,
        industryType: org.industryType,
      });

      const orgUsers = await apiGet<OrgUserResponse[]>("/org-users", accessToken, apiBaseUrl.trim());
      await db.orgUsers.clear();
      await db.orgUsers.bulkPut(orgUsers.map((ou) => ({ id: ou.id, role: ou.role, fullName: ou.user.fullName })));

      const products = await apiGet<ProductResponse[]>("/products", accessToken, apiBaseUrl.trim());
      const variants = products.flatMap((product) =>
        product.variants.map((variant) => ({
          id: variant.id,
          productId: product.id,
          productName: product.name,
          sku: variant.sku,
          barcode: variant.barcode,
          price: Number(variant.price),
          taxRate: product.taxClass && !product.taxClass.isExempt ? Number(product.taxClass.rate) : 0,
          quantityMode: variant.quantityMode,
        })),
      );
      await db.variants.clear();
      await db.variants.bulkPut(variants);

      const now = new Date().toISOString();
      await db.deviceConfig.update("device", { orgUsersCachedAt: now, catalogCachedAt: now });

      router.replace("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed - try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Terminal Setup</h1>
        <p className="mt-1 text-sm text-slate-400">
          One-time setup for this device. A manager logs in once to pick this terminal and fetch the cashier list and
          catalog; after this, cashiers just PIN in.
        </p>

        {step === 1 && (
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
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
              <label className="block text-sm font-medium text-slate-300">Manager email</label>
              <input
                type="email"
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Manager password</label>
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
              className="w-full rounded-md bg-blue-600 p-3 text-lg font-semibold hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Signing in..." : "Continue"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleFinish} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">Branch</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setTerminalId("");
                }}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Terminal</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={terminalId}
                onChange={(e) => setTerminalId(e.target.value)}
                required
              >
                <option value="">Select a terminal...</option>
                {terminalsForBranch.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.deviceLabel}
                  </option>
                ))}
              </select>
              {terminalsForBranch.length === 0 && (
                <p className="mt-1 text-xs text-amber-400">
                  No terminals at this branch yet - add one in the back office first.
                </p>
              )}
            </div>

            {error && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{error}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-md bg-slate-700 p-3">
                Back
              </button>
              <button
                type="submit"
                disabled={busy || !terminalId}
                className="flex-1 rounded-md bg-blue-600 p-3 text-lg font-semibold hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? "Setting up..." : "Finish setup"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
