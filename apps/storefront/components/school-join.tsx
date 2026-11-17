"use client";

import { KENYA_COUNTIES, PasswordInput } from "@zaroda/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { schoolJoin, schoolPortalInfo, type SchoolJoinForm } from "../lib/school-api";

const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
const primary = "rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const EMPTY: SchoolJoinForm = { name: "", contactName: "", phone: "", email: "", address: "", county: "", notes: "", pin: "" };

/** The supplier's joining link: a school fills in its details and chooses a PIN, then waits for the supplier to approve it. */
export default function SchoolJoin({ slug }: { slug: string }) {
  const [info, setInfo] = useState<{ displayName: string; joinEnabled: boolean } | null | undefined>(undefined);
  const [form, setForm] = useState<SchoolJoinForm>(EMPTY);
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    schoolPortalInfo(slug).then(setInfo, () => setInfo(null));
  }, [slug]);

  const set = (k: keyof SchoolJoinForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.pin !== pin2) return setError("The two PINs are not the same.");
    setBusy(true);
    setError(null);
    try {
      await schoolJoin(slug, { ...form, address: form.address || undefined, county: form.county || undefined, notes: form.notes || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send your request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (info === undefined) return <p className="py-10 text-center text-secondary-500">Loading...</p>;
  if (!info || !info.joinEnabled) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-6 text-center">
        <h1 className="text-xl font-bold">This joining link is not working</h1>
        <p className="mt-2 text-secondary-500">Ask your supplier for a new link, or to add your school for you.</p>
      </div>
    );
  }
  if (done) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-lg border border-success-600 bg-success-50 p-6 text-success-900">
        <h1 className="text-xl font-bold">Request sent to {info.displayName}</h1>
        <p>They will check your details and set your credit terms. Once they approve your school, sign in with your phone number and the PIN you chose.</p>
        <Link href={`/schools/${slug}`} className="inline-block font-semibold text-primary-600 hover:underline">
          Go to the sign-in page
        </Link>
      </div>
    );
  }

  const ready = form.name.trim().length >= 2 && form.contactName.trim().length >= 2 && form.phone.trim().length >= 9 && form.email.includes("@") && form.pin.length >= 4 && pin2.length >= 4;
  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Join {info.displayName}</h1>
        <p className="mt-1 text-secondary-500">Fill in your school&apos;s details to order supplies from {info.displayName} on account. They approve each school before it can order.</p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-surface p-6">
        <div>
          <label htmlFor="j-name" className="block text-sm font-medium">School name</label>
          <input id="j-name" value={form.name} onChange={set("name")} placeholder="e.g. Kisumu Girls High School" className={field} />
        </div>
        <div>
          <label htmlFor="j-contact" className="block text-sm font-medium">Contact person</label>
          <input id="j-contact" value={form.contactName} onChange={set("contactName")} placeholder="e.g. the bursar or storekeeper" className={field} />
        </div>
        <div>
          <label htmlFor="j-phone" className="block text-sm font-medium">Phone number</label>
          <input id="j-phone" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} placeholder="0712 345 678" className={field} />
          <p className="mt-1 text-xs text-secondary-500">You sign in with this number.</p>
        </div>
        <div>
          <label htmlFor="j-email" className="block text-sm font-medium">School email</label>
          <input id="j-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="bursar@school.ac.ke" className={field} />
          <p className="mt-1 text-xs text-secondary-500">Invoices and order updates come here. Already buying from other suppliers on Zaroda? Use the same email and phone: each supplier keeps its own account for you.</p>
        </div>
        <div>
          <label htmlFor="j-county" className="block text-sm font-medium">County</label>
          <select id="j-county" value={form.county} onChange={set("county")} className={field}>
            <option value="">Choose...</option>
            {KENYA_COUNTIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="j-address" className="block text-sm font-medium">Address for deliveries (optional)</label>
          <input id="j-address" value={form.address} onChange={set("address")} placeholder="P.O. Box, town, directions" className={field} />
        </div>
        <div>
          <label htmlFor="j-notes" className="block text-sm font-medium">Anything else (optional)</label>
          <textarea id="j-notes" rows={2} value={form.notes} onChange={set("notes")} placeholder="e.g. KRA PIN, what you usually order" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="j-pin" className="block text-sm font-medium">Choose a PIN</label>
            <PasswordInput id="j-pin" inputMode="numeric" autoComplete="new-password" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="4-6 digits" className={field} />
          </div>
          <div>
            <label htmlFor="j-pin2" className="block text-sm font-medium">PIN again</label>
            <PasswordInput id="j-pin2" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} className={field} />
          </div>
        </div>
        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
        <button type="submit" disabled={busy || !ready} className={`${primary} w-full`}>
          {busy ? "Sending..." : `Ask to join ${info.displayName}`}
        </button>
        <p className="text-center text-xs text-secondary-500">
          Already approved?{" "}
          <Link href={`/schools/${slug}`} className="text-primary-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
