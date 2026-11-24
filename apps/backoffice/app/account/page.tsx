"use client";

import { PasswordInput } from "@zaroda/ui";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

const field = "w-full rounded-md border border-border bg-background p-2.5 text-sm";

/** Change my own password, for anyone signed in to the back office. */
export default function AccountPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) router.replace("/login");
    else setSessionState(s);
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (next !== confirm) return setError("The two new passwords are not the same");
    setBusy(true);
    setError(null);
    try {
      await apiPost("/auth/change-password", { currentPassword: current, newPassword: next });
      setSaved(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-md p-4 sm:p-6">
        <h1 className="text-xl font-bold">My password</h1>
        <p className="mt-1 text-sm text-secondary-500">Signed in as {session.email}. The new password works for every Zaroda business you belong to.</p>

        <form onSubmit={save} className="mt-5 space-y-4 rounded-lg border border-border p-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Current password</label>
            <PasswordInput className={field} value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">New password (at least 8 characters)</label>
            <PasswordInput className={field} value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required autoComplete="new-password" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">New password again</label>
            <PasswordInput className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {saved && <p className="text-sm font-medium text-primary-600">Password changed. Use the new one next time you sign in.</p>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-primary-600 p-2.5 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-40">
            {busy ? "Saving..." : "Change password"}
          </button>
        </form>
        <p className="mt-4 text-xs text-secondary-500">
          Forgotten your current password? Sign out and use &quot;Forgot password?&quot; on the sign-in page.
        </p>
      </main>
    </div>
  );
}
