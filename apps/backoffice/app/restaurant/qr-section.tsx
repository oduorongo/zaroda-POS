"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { apiGet, ApiError } from "../../lib/api";

interface Table {
  id: string;
  label: string;
  seats: number;
}
interface OnlineStore {
  addonActive: boolean;
  isPublished: boolean;
  slug: string | null;
  displayName: string | null;
}

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://shop.zarodashop.com").replace(/\/+$/, "");
const NAVY = "#0a1633";

/**
 * A printable card for every table: its own QR code, which opens the restaurant's menu already knowing which table
 * the customer is at. Customers order, pay by M-Pesa and the order goes straight to the kitchen screens.
 */
export function QrSection({ tables, stationCount }: { tables: Table[]; stationCount: number }) {
  const [store, setStore] = useState<OnlineStore | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Set when Zaroda has switched table ordering off for this business.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ blockedReason: string | null }>("/restaurant/dishes/ordering-status").then((r) => setBlockedReason(r.blockedReason)).catch(() => undefined);
    apiGet<OnlineStore>("/online-store/me")
      .then(setStore)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your shop details."));
  }, []);

  const slug = store?.slug ?? null;
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const table of tables) {
        next[table.id] = await QRCode.toDataURL(`${STOREFRONT_URL}/s/${slug}/table/${table.id}`, { errorCorrectionLevel: "H", margin: 1, width: 600, color: { dark: NAVY, light: "#ffffff" } });
      }
      if (!cancelled) setCodes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, tables]);

  const ready = store?.addonActive && store.isPublished && slug;

  return (
    <div className="space-y-4">
      <div className="space-y-2 print:hidden">
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {blockedReason && (
          <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">
            Zaroda has switched off ordering from your table QR codes: {blockedReason}. Diners who scan them are told ordering is off. Orders already paid for carry on as normal. Please contact Zaroda.
          </p>
        )}
        {store && !store.addonActive && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Table ordering uses the Online Shop add-on, which is not switched on for your business yet. Contact Zaroda to enable it.</p>}
        {store?.addonActive && (!slug || !store.isPublished) && (
          <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Set your shop link and switch your shop live under Settings → Online Shop first. The QR codes only work while the shop is live.</p>
        )}
        {stationCount === 0 && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Add at least one kitchen station on the Menu &amp; kitchen tab. Without a station, customers cannot order from the table.</p>}
        {tables.length === 0 && <p className="text-sm text-secondary-500">Add your tables on the Menu &amp; kitchen tab first.</p>}
        {ready && tables.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">
              <Printer size={16} aria-hidden /> Print table cards
            </button>
            <p className="text-xs text-secondary-500">One card per table, four to an A4 page. Cut them out and stand or stick one on each table. Each QR code is for that table only.</p>
          </div>
        )}
      </div>

      {ready && (
        <div className="grid grid-cols-2 gap-3 print:gap-0">
          {tables.map((table) => (
            <div key={table.id} className="flex break-inside-avoid flex-col items-center rounded-lg border border-dashed border-border bg-white p-4 text-center text-slate-900 print:rounded-none print:p-6" style={{ pageBreakInside: "avoid" }}>
              <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: NAVY }}>
                {store?.displayName ?? "Our restaurant"}
              </p>
              <p className="mt-1 text-lg font-bold">Scan to order &amp; pay</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {codes[table.id] ? <img src={codes[table.id]} alt={`QR code for ${table.label}`} className="my-2 h-44 w-44 print:h-56 print:w-56" /> : <div className="my-2 h-44 w-44 print:h-56 print:w-56" />}
              <p className="text-2xl font-extrabold" style={{ color: NAVY }}>
                {table.label}
              </p>
              <p className="mt-1 text-xs text-slate-600">View the menu, pay with M-Pesa, and your food comes to your table.</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
