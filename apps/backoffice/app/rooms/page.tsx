"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { BookingsSection } from "./bookings-section";
import { RoomTypesSection } from "./room-types-section";
import { AvailabilitySection } from "./availability-section";

type Tab = "bookings" | "types" | "availability";
const TABS: [Tab, string][] = [
  ["bookings", "Bookings"],
  ["types", "Room types & photos"],
  ["availability", "Availability"],
];

/**
 * A hotel's rooms: what it offers (shown on the marketplace's Hotels page), who has booked, and who is in the house.
 * Guests pay a deposit by M-Pesa when they book; the balance is settled at the hotel. Owners and managers only.
 */
export default function RoomsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("bookings");

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    if (s.industryType !== "RESTAURANT") {
      router.replace("/sales");
      return;
    }
    setSession(s);
  }, [router]);

  if (!session) return null;
  const isManager = session.role === "MANAGER" || session.role === "OWNER";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold">Hotel rooms</h1>
          <p className="text-sm text-secondary-500">Advertise your rooms on the marketplace, take bookings with an M-Pesa deposit, and check guests in and out.</p>
        </div>
        {!isManager ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">Owners and managers only. Ask your business owner or a manager to manage rooms.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {TABS.map(([key, label]) => (
                <button key={key} onClick={() => setTab(key)} className={`rounded-md px-3 py-2 text-sm ${tab === key ? "bg-primary-600 text-white" : "border border-border bg-surface"}`}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "bookings" && <BookingsSection />}
            {tab === "types" && <RoomTypesSection />}
            {tab === "availability" && <AvailabilitySection />}
          </>
        )}
      </main>
    </div>
  );
}
