"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, EmptyState, LoadingState } from "@zaroda/ui";

interface School {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string | null;
  county: string;
  status: "PENDING" | "APPROVED" | "SUSPENDED";
  statusNote: string | null;
  adverts: number;
  registeredAt: string;
}
interface Advert {
  id: string;
  title: string;
  school: string;
  schoolPhone: string;
  county: string;
  closingDate: string;
  status: "OPEN" | "CANCELLED" | "REMOVED";
  removedReason: string | null;
  postedAt: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE");
const BADGE = {
  PENDING: { variant: "warning", label: "Waiting" },
  APPROVED: { variant: "success", label: "Approved" },
  SUSPENDED: { variant: "error", label: "Suspended" },
} as const;

/**
 * Schools that registered to post tender adverts: check each is a real school before it may post (a posted advert is emailed to
 * every school supplier), suspend one that misuses it, and take an advert down.
 */
export default function TenderSchoolsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [schools, setSchools] = useState<School[] | null>(null);
  const [adverts, setAdverts] = useState<Advert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([apiGet<School[]>("/platform-admin/tender-schools"), apiGet<Advert[]>("/platform-admin/tender-adverts")]);
      setSchools(s);
      setAdverts(a);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this.");
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
    void load();
  }, [router, load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold">Tender schools and adverts</h1>
          <p className="mt-1 text-sm text-secondary-500">Schools register at the Zaroda shop site under &quot;/tenders&quot;. Check that each is a real school (call the number if unsure) before approving: its adverts are emailed to every school supplier.</p>
        </div>
        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-700">{error}</p>}
        {notice && <p className="rounded-md bg-success-50 p-3 text-sm text-success-700">{notice}</p>}

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Schools</h2>
          {!schools ? (
            <LoadingState label="Loading..." />
          ) : schools.length === 0 ? (
            <EmptyState title="No schools yet" description="Nobody has registered to post tender adverts." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="p-3">School</th>
                    <th className="p-3">Contact</th>
                    <th className="p-3">County</th>
                    <th className="p-3">Registered</th>
                    <th className="p-3 text-right">Adverts</th>
                    <th className="p-3">Status</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {schools.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-3 font-medium">{s.name}</td>
                      <td className="p-3">{s.contactName}<br /><span className="text-xs text-secondary-500">{s.phone}{s.email ? ` · ${s.email}` : ""}</span></td>
                      <td className="p-3">{s.county}</td>
                      <td className="p-3">{day(s.registeredAt)}</td>
                      <td className="p-3 text-right">{s.adverts}</td>
                      <td className="p-3"><Badge variant={BADGE[s.status].variant}>{BADGE[s.status].label}</Badge>{s.statusNote && <span className="ml-2 text-xs text-secondary-500">{s.statusNote}</span>}</td>
                      <td className="p-3 text-right">
                        {s.status !== "APPROVED" && (
                          <button onClick={() => void act(() => apiPost(`/platform-admin/tender-schools/${s.id}/status`, { status: "APPROVED" }), `${s.name} approved.`)} className="text-primary-600 hover:underline">Approve</button>
                        )}
                        {s.status === "APPROVED" && (
                          <button
                            onClick={() => {
                              const note = window.prompt("Why is it being suspended? (its open adverts are taken down)");
                              if (note === null) return;
                              void act(() => apiPost(`/platform-admin/tender-schools/${s.id}/status`, { status: "SUSPENDED", note }), `${s.name} suspended.`);
                            }}
                            className="text-error-600 hover:underline"
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Adverts</h2>
          {!adverts ? (
            <LoadingState label="Loading..." />
          ) : adverts.length === 0 ? (
            <EmptyState title="No adverts yet" description="No school has posted a tender advert." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="p-3">Advert</th>
                    <th className="p-3">School</th>
                    <th className="p-3">Closes</th>
                    <th className="p-3">Status</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {adverts.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="p-3 font-medium">{a.title}<br /><span className="text-xs text-secondary-500">{a.county} · posted {day(a.postedAt)}</span></td>
                      <td className="p-3">{a.school}<br /><span className="text-xs text-secondary-500">{a.schoolPhone}</span></td>
                      <td className="p-3">{a.closingDate}</td>
                      <td className="p-3">
                        <Badge variant={a.status === "OPEN" ? "success" : a.status === "REMOVED" ? "error" : "neutral"}>{a.status === "OPEN" ? "Open" : a.status === "REMOVED" ? "Taken down" : "Withdrawn"}</Badge>
                        {a.removedReason && <span className="ml-2 text-xs text-secondary-500">{a.removedReason}</span>}
                      </td>
                      <td className="p-3 text-right">
                        {a.status === "OPEN" && (
                          <button
                            onClick={() => {
                              const reason = window.prompt("Why is it being taken down? (the school will see this)");
                              if (!reason || reason.trim().length < 3) return;
                              void act(() => apiPost(`/platform-admin/tender-adverts/${a.id}/remove`, { reason: reason.trim() }), "Taken down.");
                            }}
                            className="text-error-600 hover:underline"
                          >
                            Take down
                          </button>
                        )}
                        {a.status === "REMOVED" && <button onClick={() => void act(() => apiPost(`/platform-admin/tender-adverts/${a.id}/restore`, {}), "Put back.")} className="text-primary-600 hover:underline">Put back</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
