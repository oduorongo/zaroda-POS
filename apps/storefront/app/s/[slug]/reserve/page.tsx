import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReservationForm from "../../../../components/reservation-form";
import { ApiError, getReservationInfo } from "../../../../lib/api";

// Whether a restaurant is taking requests can change at any time, so this is never served from a cache.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reserve a table" };

export default async function ReservePage({ params }: { params: { slug: string } }) {
  let info: { enabled: boolean; restaurant: string };
  try {
    info = await getReservationInfo(params.slug);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  if (!info.enabled) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <h1 className="text-xl font-semibold">{info.restaurant} is not taking table requests online</h1>
        <p className="text-secondary-600">Please call the restaurant to book a table.</p>
        <Link href={`/s/${params.slug}`} className="inline-block text-primary-600 hover:underline">
          Back to {info.restaurant}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Link href={`/s/${params.slug}`} className="text-sm text-primary-600 hover:underline">
        Back to {info.restaurant}
      </Link>
      <ReservationForm slug={params.slug} restaurant={info.restaurant} />
    </div>
  );
}
