import type { Metadata } from "next";
import { Suspense } from "react";
import ReservationStatus from "../../../components/reservation-status";

// A guest's own reservation page: private to whoever holds the link, and never worth indexing.
export const metadata: Metadata = { title: "Your table request", robots: { index: false } };

export default function ReservationPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-secondary-500">Loading your request...</p>}>
      <ReservationStatus reservationId={params.id} />
    </Suspense>
  );
}
