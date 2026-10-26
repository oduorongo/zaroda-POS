"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  tenderAdverts,
  tenderCancel,
  tenderLogin,
  tenderMe,
  tenderPost,
  tenderRegister,
  tenderRemovePdf,
  tenderUpdate,
  tenderUploadPdf,
  type SaveAdvert,
  type TenderAdvert,
  type TenderSchool,
} from "../lib/tender-api";

const TOKEN_KEY = "zaroda_tender_token";
const readToken = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
};

const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
const primary = "rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const tomorrowPlus = (n: number) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

/** Where a school registers, signs in and posts a tender advert that every school supplier on Zaroda can see. */
export default function TenderPortal() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = readToken();
      if (saved) {
        try {
          await tenderMe(saved);
          setToken(saved);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) writeToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;
  if (!token)
    return (
      <SignIn
        onSignedIn={(t) => {
          writeToken(t);
          setToken(t);
        }}
      />
    );
  return (
    <Board
      token={token}
      onSignOut={() => {
        writeToken(null);
        setToken(null);
      }}
    />
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [f, setF] = useState({ name: "", contactName: "", phone: "", email: "", county: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s =
        mode === "signin"
          ? await tenderLogin(f.phone.trim(), f.pin.trim())
          : await tenderRegister({ name: f.name.trim(), contactName: f.contactName.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, county: f.county.trim(), pin: f.pin.trim() });
      onSignedIn(s.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Post a tender advert</h1>
        <p className="mt-2 text-secondary-500">Tell school suppliers what your school wants to buy. Every supplier on Zaroda sees it and gets an email.</p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex gap-2 text-sm">
          <button type="button" onClick={() => setMode("signin")} className={`rounded-full border px-3 py-1 ${mode === "signin" ? "border-primary-600 bg-primary-600 text-white" : "border-border"}`}>Sign in</button>
          <button type="button" onClick={() => setMode("register")} className={`rounded-full border px-3 py-1 ${mode === "register" ? "border-primary-600 bg-primary-600 text-white" : "border-border"}`}>Register my school</button>
        </div>
        {mode === "register" && (
          <>
            <label className="block text-sm">School name<input required minLength={3} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} /></label>
            <label className="block text-sm">Your name<input required minLength={2} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} className={field} /></label>
            <label className="block text-sm">County<input required minLength={2} value={f.county} onChange={(e) => setF({ ...f, county: e.target.value })} className={field} /></label>
            <label className="block text-sm">Email <span className="text-secondary-500">(optional)</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={field} /></label>
          </>
        )}
        <label className="block text-sm">Phone number<input required inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0712 345 678" className={field} /></label>
        <label className="block text-sm">
          PIN {mode === "register" && <span className="text-secondary-500">(choose 4 to 6 digits)</span>}
          <input required type="password" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} className={field} />
        </label>
        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
        <button type="submit" disabled={busy} className={`${primary} w-full`}>{mode === "signin" ? "Sign in" : "Register"}</button>
        {mode === "register" && <p className="text-xs text-secondary-500">Zaroda checks that every school is real before it can post. You can sign in straight away; you will be able to post once you are approved.</p>}
      </form>
    </div>
  );
}

const blank = (school: TenderSchool): SaveAdvert & { itemsText: string } => ({
  reference: "",
  title: "",
  description: "",
  county: school.county,
  items: [],
  itemsText: "",
  documentsInfo: "",
  closingDate: tomorrowPlus(14),
  contactName: school.contactName,
  contactPhone: school.phone.replace(/^254/, "0"),
  contactEmail: school.email ?? "",
});

/** Items are typed one per line: "Exercise books, 500, pcs". */
function parseItems(text: string): SaveAdvert["items"] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [description, qty, unit] = l.split(",").map((p) => p.trim());
      const quantity = Number(qty);
      return { description, quantity: quantity > 0 ? quantity : undefined, unit: unit || undefined };
    });
}

function Board({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [school, setSchool] = useState<TenderSchool | null>(null);
  const [adverts, setAdverts] = useState<TenderAdvert[] | null>(null);
  const [form, setForm] = useState<(SaveAdvert & { itemsText: string; id?: string }) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([tenderMe(token), tenderAdverts(token)]);
      setSchool(s);
      setAdverts(a);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSignOut();
      else setError(err instanceof ApiError ? err.message : "Could not load your adverts.");
    }
  }, [token, onSignOut]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: SaveAdvert = {
      reference: form.reference?.trim() || undefined,
      title: form.title.trim(),
      description: form.description.trim(),
      county: form.county.trim(),
      items: parseItems(form.itemsText),
      documentsInfo: form.documentsInfo?.trim() || undefined,
      closingDate: form.closingDate,
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      contactEmail: form.contactEmail?.trim() || undefined,
    };
    try {
      const saved = form.id ? await tenderUpdate(token, form.id, body) : await tenderPost(token, body);
      let pdfProblem: string | null = null;
      if (file) {
        try {
          await tenderUploadPdf(token, saved.id, file);
        } catch (err) {
          pdfProblem = err instanceof ApiError ? err.message : "the PDF could not be uploaded";
        }
      }
      setForm(null);
      setFile(null);
      if (pdfProblem) setError(`The advert was ${form.id ? "saved" : "posted"}, but the PDF was not attached: ${pdfProblem}. You can attach it again from the list below.`);
      else setNotice(form.id ? "Saved." : "Posted. Suppliers can see it now and have been emailed.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save it.");
    } finally {
      setBusy(false);
    }
  }

  if (!school || !adverts) return <p className="py-10 text-center text-secondary-500">Loading...</p>;
  const approved = school.status === "APPROVED";

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{school.name}</h1>
          <p className="text-sm text-secondary-500">Tender adverts for school suppliers</p>
        </div>
        <button onClick={onSignOut} className="text-sm text-primary-600 hover:underline">Sign out</button>
      </div>
      {school.status === "PENDING" && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-900">Your school is waiting to be approved. Zaroda checks every school before it can post. You will be able to post an advert here as soon as it is approved.</p>}
      {school.status === "SUSPENDED" && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">This account has been suspended{school.statusNote ? `: ${school.statusNote}` : ""}. Please contact Zaroda.</p>}
      {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-900">{error}</p>}
      {notice && <p className="rounded-md bg-success-50 p-3 text-sm text-success-900">{notice}</p>}

      {approved && !form && <button onClick={() => setForm(blank(school))} className={primary}>Post a new tender advert</button>}

      {form && (
        <form onSubmit={save} className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="font-semibold">{form.id ? "Change the advert" : "New tender advert"}</p>
          <label className="block">Title<input required minLength={5} maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Supply of stationery for Term 1" className={field} /></label>
          <label className="block">What do you want? <span className="text-secondary-500">Describe it so suppliers know whether to bid</span><textarea required minLength={10} maxLength={3000} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={field} /></label>
          <label className="block">Items <span className="text-secondary-500">(optional) one per line: name, quantity, unit</span><textarea rows={4} value={form.itemsText} onChange={(e) => setForm({ ...form, itemsText: e.target.value })} placeholder={"Exercise books 96 pages, 500, pcs\nBlue pens, 200, boxes"} className={field} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">Closing date<input required type="date" min={tomorrowPlus(1)} max={tomorrowPlus(180)} value={form.closingDate} onChange={(e) => setForm({ ...form, closingDate: e.target.value })} className={field} /></label>
            <label className="block">County<input required value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })} className={field} /></label>
          </div>
          <div className="text-sm">
            <p>Your tender document <span className="text-secondary-500">(optional PDF, up to 10MB)</span></p>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
            {form.id && !file && <p className="mt-1 text-xs text-secondary-500">Choose a file to replace the one already attached.</p>}
          </div>
          <label className="block">Your tender number <span className="text-secondary-500">(optional)</span><input value={form.reference ?? ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={field} /></label>
          <label className="block">How do suppliers get the full tender documents? <span className="text-secondary-500">(optional)</span><input maxLength={500} value={form.documentsInfo ?? ""} onChange={(e) => setForm({ ...form, documentsInfo: e.target.value })} placeholder="Collect from the school office, or a link" className={field} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">Contact person<input required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className={field} /></label>
            <label className="block">Contact phone<input required inputMode="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className={field} /></label>
          </div>
          <label className="block">Contact email <span className="text-secondary-500">(optional)</span><input type="email" value={form.contactEmail ?? ""} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={field} /></label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primary}>{form.id ? "Save" : "Post the advert"}</button>
            <button type="button" onClick={() => { setForm(null); setFile(null); }} className="rounded-md border border-border px-4 py-3 hover:bg-secondary-500/10">Cancel</button>
          </div>
        </form>
      )}

      <div>
        <p className="mb-1 text-xs uppercase text-secondary-500">Your adverts</p>
        {adverts.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">You have not posted any adverts yet.</p>}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {adverts.map((a) => (
            <li key={a.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-xs text-secondary-500">Closes {a.closingDate}{a.reference ? ` · ${a.reference}` : ""}</p>
                </div>
                <span className="text-xs">
                  {a.status === "OPEN" && !a.closed && <span className="rounded bg-success-50 px-2 py-0.5 text-success-900">Open to suppliers</span>}
                  {a.status === "OPEN" && a.closed && <span className="rounded bg-secondary-500/10 px-2 py-0.5">Closed</span>}
                  {a.status === "CANCELLED" && <span className="rounded bg-secondary-500/10 px-2 py-0.5">Withdrawn</span>}
                  {a.status === "REMOVED" && <span className="rounded bg-error-50 px-2 py-0.5 text-error-900">Taken down</span>}
                </span>
              </div>
              {a.removedReason && <p className="text-xs text-error-900">Reason: {a.removedReason}</p>}
              {a.pdfUrl && (
                <p className="text-xs">
                  <a href={a.pdfUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">PDF: {a.pdfName ?? "tender document"}</a>
                  {a.status === "OPEN" && !a.closed && (
                    <button
                      onClick={async () => {
                        try {
                          await tenderRemovePdf(token, a.id);
                          await load();
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : "Could not remove the PDF.");
                        }
                      }}
                      className="ml-3 text-error-600 hover:underline"
                    >
                      Remove the PDF
                    </button>
                  )}
                </p>
              )}
              {a.status === "OPEN" && !a.closed && (
                <p className="flex gap-3 text-xs">
                  <button
                    onClick={() => setForm({ ...a, reference: a.reference ?? "", documentsInfo: a.documentsInfo ?? "", contactEmail: a.contactEmail ?? "", contactPhone: a.contactPhone.replace(/^254/, "0"), items: [], itemsText: a.items.map((i) => [i.description, i.quantity ?? "", i.unit ?? ""].join(", ").replace(/(, )+$/, "")).join("\n") })}
                    className="text-primary-600 hover:underline"
                  >
                    Change
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm("Withdraw this advert? Suppliers will no longer see it.")) return;
                      try {
                        await tenderCancel(token, a.id);
                        await load();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Could not withdraw it.");
                      }
                    }}
                    className="text-error-600 hover:underline"
                  >
                    Withdraw
                  </button>
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-secondary-500">Today is {today()}. Adverts can close up to 180 days ahead.</p>
    </div>
  );
}
