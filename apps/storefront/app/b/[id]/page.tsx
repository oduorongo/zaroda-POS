import type { Metadata } from "next";
import { Suspense } from "react";
import BookingStatus from "../../../components/booking-status";

// A guest's own booking page: private to whoever holds the link, and never worth indexing.
export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

export default function BookingPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-secondary-500">Loading your booking...</p>}>
      <BookingStatus bookingId={params.id} />
    </Suspense>
  );
}
