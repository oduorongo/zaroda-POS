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

/**
 * First-run device provisioning. There's no backoffice UI to generate a
 * terminal/branch id yet (DESIGN.md's admin-tooling gap), so an admin
 * copies these in manually from the API/seed output - acknowledged
 * limitation, not an oversight. What this screen DOES do properly: a
 * one-time manager login to fetch and cache the cashier list + catalog
 * snapshot, after which the terminal never needs that manager's
 * credentials again - it switches to PIN-based cashier login from here on
 * (DESIGN.md §9).
 */
export default function SetupPage() {
  const router = useRouter();
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3001");
  const [branchId, setBranchId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Save device identity first - if the login/catalog fetch below fails
      // partway, the operator can just retry without re-typing the ids.
      await db.deviceConfig.put({
        id: "device",
        apiBaseUrl: apiBaseUrl.trim(),
        branchId: branchId.trim(),
        terminalId: terminalId.trim(),
        branchName: "",
        terminalLabel: "",
        orgUsersCachedAt: null,
        catalogCachedAt: null,
        industryType: "RETAIL",
      });

      const { accessToken } = await apiPost<LoginResponse>("/auth/login", { email, password });

      const org = await apiGet<OrganizationResponse>("/organizations/me", accessToken);
      await db.deviceConfig.update("device", { industryType: org.industryType });

      const orgUsers = await apiGet<OrgUserResponse[]>("/org-users", accessToken);
      await db.orgUsers.clear();
      await db.orgUsers.bulkPut(orgUsers.map((ou) => ({ id: ou.id, role: ou.role, fullName: ou.user.fullName })));

      const products = await apiGet<ProductResponse[]>("/products", accessToken);
      const variants = products.flatMap((product) =>
        product.variants.map((variant) => ({
          id: variant.id,
          productId: product.id,
          productName: product.name,
          sku: variant.sku,
          barcode: variant.barcode,
          price: Number(variant.price),
          taxRate: product.taxClass && !product.taxClass.isExempt ? Number(product.taxClass.rate) : 0,
        })),
      );
      await db.variants.clear();
      await db.variants.bulkPut(variants);

      const now = new Date().toISOString();
      await db.deviceConfig.update("device", { orgUsersCachedAt: now, catalogCachedAt: now });

      router.replace("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Terminal Setup</h1>
        <p className="mt-1 text-sm text-slate-400">
          One-time setup for this device. A manager logs in once to fetch the cashier list and catalog; after this,
          cashiers just PIN in.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">API base URL</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-300">Branch ID</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Terminal ID</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 p-2.5"
                value={terminalId}
                onChange={(e) => setTerminalId(e.target.value)}
                required
              />
            </div>
          </div>
          <hr className="border-slate-700" />
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
            {busy ? "Setting up..." : "Set up this terminal"}
          </button>
        </form>
      </div>
    </div>
  );
}
