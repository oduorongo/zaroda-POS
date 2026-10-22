"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../../../lib/api";
import { getSession } from "../../../../lib/auth";
import { MEAL_LABEL, type MealPlan } from "../../../front-desk/types";

interface Card {
  business: { name: string; address: string | null; phone: string | null } | null;
  bookingNumber: string;
  guestName: string;
  phone: string;
  email: string | null;
  idNumber: string | null;
  nationality: string | null;
  address: string | null;
  vehicleReg: string | null;
  roomTypeName: string;
  roomNumbers: string[];
  rooms: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  mealPlan: MealPlan;
  printedOn: string;
}

/** The registration card a guest signs at check-in, on a plain white page for the printer. */
export default function PrintRegistrationCardPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) return void router.replace("/login");
    apiGet<Card>(`/hotel/bookings/${id}/registration-card`).then(setCard).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this page."));
  }, [id, router]);

  const row = (label: string, value: string | null | undefined) => (
    <tr className="border-b border-gray-200">
      <td className="w-48 py-2 pr-4 text-xs uppercase text-gray-500">{label}</td>
      <td className="py-2 font-medium">{value || <span className="text-gray-400">—</span>}</td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-white p-6 text-black print:min-h-0 print:p-0">
      <style>{`@media print { body > footer { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex justify-end print:hidden">
          <button onClick={() => window.print()} className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white">Print / save as PDF</button>
        </div>
        {error && <p className="text-red-700">{error}</p>}
        {card && (
          <div className="rounded border border-gray-400 p-6">
            <div className="flex items-start justify-between border-b border-gray-400 pb-3">
              <div>
                <h1 className="text-xl font-bold">{card.business?.name}</h1>
                {card.business?.address && <p className="text-sm text-gray-700">{card.business.address}</p>}
                {card.business?.phone && <p className="text-sm text-gray-700">{card.business.phone}</p>}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold uppercase">Registration card</p>
                <p className="font-mono text-sm">{card.bookingNumber}</p>
              </div>
            </div>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {row("Guest name", card.guestName)}
                {row("ID / passport no.", card.idNumber)}
                {row("Nationality", card.nationality)}
                {row("Phone", card.phone)}
                {row("Email", card.email)}
                {row("Address", card.address)}
                {row("Vehicle registration", card.vehicleReg)}
                {row("Room", `${card.roomTypeName}${card.rooms > 1 ? ` × ${card.rooms}` : ""}${card.roomNumbers.length > 0 ? ` — Room ${card.roomNumbers.join(", ")}` : ""}`)}
                {row("Arrival", card.checkIn)}
                {row("Departure", `${card.checkOut} (${card.nights} night${card.nights === 1 ? "" : "s"})`)}
                {row("Guests", `${card.adults} adult${card.adults === 1 ? "" : "s"}${card.children > 0 ? `, ${card.children} child${card.children === 1 ? "" : "ren"}` : ""}`)}
                {row("Meals", MEAL_LABEL[card.mealPlan])}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-gray-700">I confirm that the details above are correct and I agree to the hotel&apos;s terms and house rules.</p>
            <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
              <div className="border-t border-gray-500 pt-1">Guest signature</div>
              <div className="border-t border-gray-500 pt-1">Date</div>
            </div>
            <div className="mt-8 border-t border-gray-300 pt-3 text-center text-[10px] italic text-gray-500">
              <p>Printed {card.printedOn.slice(0, 10)}. The ID number is kept on file only to register the stay.</p>
              <p>Powered by ZARODA SOLUTIONS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
