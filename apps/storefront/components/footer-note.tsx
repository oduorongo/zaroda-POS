"use client";

import { usePathname } from "next/navigation";

/** The line above the bottom ribbon, in the words of the page's own business. A shop's own page names the shop itself (see ShopView). */
export function footerNote(path: string): string | null {
  if (path.startsWith("/schools/")) return "Orders are on account: your supplier invoices your school, and you pay them as agreed.";
  if (/^\/s\/[^/]+\/?$/.test(path)) return null;
  if (/^\/s\/[^/]+\/reserve/.test(path) || path.startsWith("/r/")) return "Your table request goes straight to the restaurant.";
  if (/^\/s\/[^/]+\/table/.test(path) || path.startsWith("/t/")) return "Your payment goes directly to the restaurant through M-Pesa.";
  if (path.startsWith("/s/")) return "Your payment goes directly to the business through M-Pesa.";
  if (path.startsWith("/hotels")) return "Room deposits go directly to the hotel through M-Pesa. The rest is paid at the hotel.";
  if (path.startsWith("/b/")) return "Your deposit goes directly to the hotel through M-Pesa. The rest is paid at the hotel.";
  if (path.startsWith("/houses")) return "Zaroda does not collect rent or deposits for these houses. See the house before paying the landlord or agent anything.";
  if (path.startsWith("/tenant")) return "Rent you pay here goes directly to your landlord through M-Pesa.";
  if (path.startsWith("/tenders") || path.startsWith("/rider")) return null;
  return "Payments go directly to each shop through M-Pesa.";
}

export default function FooterNote() {
  const note = footerNote(usePathname() ?? "/");
  return note ? <p className="px-4 pb-4 text-center text-xs text-secondary-500">{note}</p> : null;
}
