"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, EmptyState, Input, LoadingState, Modal, ModalFooter } from "@zaroda/ui";

type State = "UNPAID" | "LIVE" | "EXPIRED" | "PAUSED" | "BLOCKED";

interface Advert {
  id: string;
  organizationId: string;
  organizationName: string;
  propertyName: string;
  unitLabel: string;
  title: string;
  unitType: string;
  area: string;
  monthlyRent: number;
  contactName: string | null;
  contactPhone: string;
  state: State;
  paidUntil: string | null;
  blockedReason: string | null;
  blockedAt: string | null;
  photoCount: number;
  coverImage: string | null;
  timesPaid: number;
  totalPaid: number;
  createdAt: string;
}

interface Overview {
  summary: { total: number; live: number; unpaid: number; expired: number; paused: number; blocked: number; totalCollected: number };
  adverts: Advert[];
}

const SHOP_URL = (process.env.NEXT_PUBLIC_SHOP_URL ?? "https://shop.zarodashop.com").replace(/\/+$/, "");
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE");
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

type Filter = "ALL" | "LIVE" | "NEEDS_PAYMENT" | "PAUSED" | "BLOCKED";
const FILTERS: [Filter, string][] = [
  ["ALL", "All"],
  ["LIVE", "Live"],
  ["NEEDS_PAYMENT", "Needs payment"],
  ["PAUSED", "Paused"],
  ["BLOCKED", "Taken down"],
];
const matches = (a: Advert, f: Filter) => (f === "ALL" ? true : f === "NEEDS_PAYMENT" ? a.state === "UNPAID" || a.state === "EXPIRED" : a.state === f);

const BADGE: Record<State, { variant: "success" | "warning" | "neutral" | "error"; label: string }> = {
  LIVE: { variant: "success", label: "Live" },
  UNPAID: { variant: "warning", label: "Not paid" },
  EXPIRED: { variant: "warning", label: "Expired" },
  PAUSED: { variant: "neutral", label: "Paused" },
  BLOCKED: { variant: "error", label: "Taken down" },
};

/**
 * Every "Houses to let" advert across all landlords: who runs it, whether it is live, what it has earned, and a way to
 * take one down (a fake or abusive advert) and restore it. Taking down switches the advert off for the public and stops
 * the landlord from turning it back on or paying for it, until it is restored here.
 */
export default function AdvertsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [blocking, setBlocking] = useState<Advert | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Overview>("/platform-admin/rental-listings"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the adverts.");
    } finally {
      setLoading(false);
    }
  }

  async function takeDown() {
    if (!blocking) return;
    setBusy(true);
    setModalError(null);
    try {
      await apiPost(`/platform-admin/organizations/${blocking.organizationId}/rental-listings/${blocking.id}/block`, { reason: reason.trim() });
      setNotice(`"${blocking.title}" has been taken down.`);
      setBlocking(null);
      setReason("");
      await load();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not take the advert down.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(advert: Advert) {
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/platform-admin/organizations/${advert.organizationId}/rental-listings/${advert.id}/unblock`, {});
      setNotice(`"${advert.title}" was restored. The landlord can switch it back on.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not restore the advert.");
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.adverts ?? []).filter(
      (a) =>
        matches(a, filter) &&
        (!q || [a.title, a.organizationName, a.area, a.propertyName, a.contactPhone, a.contactName ?? ""].some((v) => v.toLowerCase().includes(q))),
    );
  }, [data, filter, search]);

  if (!session) return null;
  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold">Houses to let adverts</h1>
        <p className="mt-1 text-sm text-secondary-500">Every advert landlords have placed, whether it is paid and live, and what it has earned you (KES 100 per advert per 30 days).</p>

        {error && <p className="mt-4 rounded-md bg-error-50 p-3 text-sm text-error-700">{error}</p>}
        {notice && <p className="mt-4 rounded-md bg-success-50 p-3 text-sm text-success-700">{notice}</p>}

        {summary && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Live", summary.live],
              ["Needs payment", summary.unpaid + summary.expired],
              ["Paused", summary.paused],
              ["Taken down", summary.blocked],
              ["All adverts", summary.total],
              ["Collected", kes(summary.totalCollected)],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-secondary-500">{label}</p>
                <p className="text-lg font-bold">{value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          {FILTERS.map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1 ${filter === value ? "border-amber-400 bg-amber-400/10 font-medium" : "border-border"}`}>
              {label}
            </button>
          ))}
          <div className="ml-auto w-full sm:w-72">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search landlord, area, title or phone" aria-label="Search adverts" />
          </div>
        </div>

        <div className="mt-4">
          {loading ? (
            <LoadingState label="Loading adverts..." />
          ) : visible.length === 0 ? (
            <EmptyState title="No adverts here" description={data && data.adverts.length > 0 ? "Nothing matches this filter or search." : "No landlord has placed an advert yet."} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="p-3">Advert</th>
                    <th className="p-3">Landlord</th>
                    <th className="p-3">Contact</th>
                    <th className="p-3 text-right">Rent</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Paid</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr key={a.id} className="border-t border-border align-top">
                      <td className="p-3">
                        <div className="flex gap-3">
                          {a.coverImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.coverImage} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                          ) : (
                            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-secondary-500/10 text-[10px] text-secondary-500">No photo</span>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium">{a.title}</p>
                            <p className="text-xs text-secondary-500">
                              {a.area} · {a.photoCount} {a.photoCount === 1 ? "photo" : "photos"}
                            </p>
                            <p className="text-xs text-secondary-500">Posted {day(a.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <p className="font-medium">{a.organizationName}</p>
                        <p className="text-xs text-secondary-500">
                          {a.propertyName} - {a.unitLabel}
                        </p>
                      </td>
                      <td className="p-3 text-xs">
                        {a.contactName && <p>{a.contactName}</p>}
                        <p className="font-mono">{a.contactPhone}</p>
                      </td>
                      <td className="p-3 text-right font-mono">{kes(a.monthlyRent)}</td>
                      <td className="p-3">
                        <Badge variant={BADGE[a.state].variant}>{BADGE[a.state].label}</Badge>
                        {a.state === "LIVE" && a.paidUntil && <span className="block text-xs text-secondary-500">{daysLeft(a.paidUntil)} days left</span>}
                        {a.state === "EXPIRED" && a.paidUntil && <span className="block text-xs text-secondary-500">ended {day(a.paidUntil)}</span>}
                        {a.state === "BLOCKED" && a.blockedReason && <span className="block max-w-[14rem] text-xs text-error-600">{a.blockedReason}</span>}
                      </td>
                      <td className="p-3 text-right">
                        <span className="font-mono">{kes(a.totalPaid)}</span>
                        <span className="block text-xs text-secondary-500">{a.timesPaid} {a.timesPaid === 1 ? "payment" : "payments"}</span>
                      </td>
                      <td className="whitespace-nowrap p-3 text-right">
                        {a.state === "LIVE" && (
                          <a href={`${SHOP_URL}/houses/${a.id}`} target="_blank" rel="noreferrer" className="mr-2 text-xs underline">
                            View public page
                          </a>
                        )}
                        {a.state === "BLOCKED" ? (
                          <Button size="sm" variant="secondary" onClick={() => void restore(a)}>
                            Restore
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setBlocking(a);
                              setReason("");
                              setModalError(null);
                            }}
                          >
                            Take down
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Modal open={!!blocking} onClose={() => setBlocking(null)} title={blocking ? `Take down - ${blocking.title}` : ""}>
          {blocking && (
            <div className="space-y-3">
              <p className="text-sm">
                This removes the advert from the public Houses to let pages straight away. {blocking.organizationName} will see your reason and cannot switch it back on or pay for it until you restore it. Money already paid is not refunded automatically.
              </p>
              <div>
                <label className="mb-1.5 block text-sm text-secondary-500">Reason (the landlord sees this)</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Photos are not of this property" />
              </div>
              {modalError && <p className="text-sm text-error-600">{modalError}</p>}
            </div>
          )}
          <ModalFooter>
            <Button variant="secondary" onClick={() => setBlocking(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void takeDown()} disabled={busy || reason.trim().length < 3}>
              {busy ? "Taking down..." : "Take down"}
            </Button>
          </ModalFooter>
        </Modal>
      </main>
    </div>
  );
}
