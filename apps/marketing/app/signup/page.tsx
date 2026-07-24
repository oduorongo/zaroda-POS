"use client";

import { useState } from "react";
import { apiPost, ApiError } from "../../lib/api";
import { Button, Input, Label } from "@zaroda/ui";

const INDUSTRY_TYPES = [
  { value: "RETAIL", label: "General retail / supermarket / minimart" },
  { value: "RESTAURANT", label: "Restaurant / eatery" },
  { value: "PHARMACY", label: "Pharmacy" },
  { value: "SALON", label: "Salon / spa" },
];

/**
 * Public self-service signup - posts directly to /auth/register, which
 * creates the org, owner account, first branch/terminal, and starts a
 * 14-day BASIC trial subscription (see AuthService.register). Card/plan
 * selection isn't collected here - the trial starts on BASIC and can be
 * upgraded from the back office once KES billing details land there.
 */
export default function SignupPage() {
  const [organizationName, setOrganizationName] = useState("");
  const [industryType, setIndustryType] = useState("RETAIL");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [branchName, setBranchName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/auth/register", {
        organizationName: organizationName.trim(),
        industryType,
        ownerFullName: ownerFullName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
        branchName: branchName.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account - try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    organizationName.trim() && ownerFullName.trim() && ownerEmail.trim() && ownerPassword.length >= 8 && branchName.trim();

  if (done) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-600 text-2xl text-white">✓</div>
        <h1 className="mt-4 text-2xl font-bold text-foreground">You&apos;re in — 14-day free trial started</h1>
        <p className="mt-2 text-secondary-500">
          Log in to your back office with the email and password you just set to add products, staff, and start selling.
        </p>
        <a
          href="http://localhost:3003/login"
          className="mt-6 inline-block rounded-md bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700"
        >
          Go to back office
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold text-foreground">Start your free trial</h1>
      <p className="mt-1 text-sm text-secondary-500">14 days, no card required. Set up your first branch and register now.</p>

      <div className="mt-6 space-y-4">
        <div>
          <Label>Business name</Label>
          <Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="e.g. Mama Njeri's Minimart" />
        </div>
        <div>
          <Label>Business type</Label>
          <select
            value={industryType}
            onChange={(e) => setIndustryType(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground"
          >
            {INDUSTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <Label>First branch name</Label>
          <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="e.g. Main Branch" />
        </div>
        <div>
          <Label>Your full name</Label>
          <Input value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
        </div>
        <div>
          <Label>Password (min 8 characters)</Label>
          <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} />
        </div>

        {error && <p className="text-sm text-error-600">{error}</p>}

        <Button onClick={() => void submit()} disabled={submitting || !canSubmit} size="lg" className="w-full">
          {submitting ? "Creating your account..." : "Start free trial"}
        </Button>
      </div>
    </main>
  );
}
