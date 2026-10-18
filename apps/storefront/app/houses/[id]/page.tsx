import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, MessageCircle, Phone, ShieldAlert } from "lucide-react";
import HouseGallery from "../../../components/house-gallery";
import { ApiError, getHouse } from "../../../lib/api";
import { displayPhone, houseTypeLabel, intlPhone, kes } from "../../../lib/format";
import type { HouseDetail } from "../../../lib/types";

export const revalidate = 30;

async function load(id: string): Promise<HouseDetail> {
  try {
    return await getHouse(id);
  } catch (err) {
    // Paused, expired or unknown adverts are simply "not found" to a visitor.
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  try {
    const house = await getHouse(params.id);
    const description = `${houseTypeLabel(house.unitType)} in ${house.area} - ${kes(house.monthlyRent)} a month.`;
    return { title: house.title, description, openGraph: { title: house.title, description, images: house.images.slice(0, 1) } };
  } catch {
    return { title: "House to let" };
  }
}

export default async function HousePage({ params }: { params: { id: string } }) {
  const house = await load(params.id);
  const phone = intlPhone(house.contactPhone);
  const whatsappText = encodeURIComponent(`Hello, I saw "${house.title}" in ${house.area} on Zaroda Marketplace. Is it still available?`);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/houses" className="inline-flex items-center gap-1.5 text-sm text-secondary-500 hover:text-foreground">
        <ArrowLeft size={15} aria-hidden /> All houses
      </Link>

      <HouseGallery images={house.images} alt={house.title} />

      <div className="space-y-2">
        <span className="inline-block rounded-full bg-primary-600 px-2.5 py-0.5 text-xs font-medium text-white">{houseTypeLabel(house.unitType)}</span>
        <h1 className="text-2xl font-bold">{house.title}</h1>
        <p className="flex items-center gap-1 text-secondary-500">
          <MapPin size={16} aria-hidden /> {house.area}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-secondary-500">Rent per month</p>
          <p className="text-xl font-bold">{kes(house.monthlyRent)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-secondary-500">Deposit</p>
          <p className="text-xl font-bold">{house.depositAmount > 0 ? kes(house.depositAmount) : "None"}</p>
        </div>
      </div>

      {house.description && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-1 font-semibold">About this house</h2>
          <p className="whitespace-pre-line text-sm text-secondary-600">{house.description}</p>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Contact {house.contactName ?? "the landlord"}</h2>
        <p className="text-sm text-secondary-500">{displayPhone(phone)}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={`tel:+${phone}`} className="flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700">
            <Phone size={18} aria-hidden /> Call
          </a>
          <a
            href={`https://wa.me/${phone}?text=${whatsappText}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-md bg-accent-600 px-4 py-3 font-semibold text-white hover:bg-accent-700"
          >
            <MessageCircle size={18} aria-hidden /> WhatsApp
          </a>
        </div>
      </section>

      <p className="flex gap-2 rounded-lg border border-border bg-surface p-3 text-xs text-secondary-500">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
        View the house before you pay anything, and never send a deposit or rent to someone you have not met. Zaroda does not handle payments for these adverts.
      </p>
    </div>
  );
}
