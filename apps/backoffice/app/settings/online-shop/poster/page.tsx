"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Download, Printer } from "lucide-react";
import { apiGet, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";
import { Button, EmptyState, LoadingState } from "@zaroda/ui";

interface OnlineStore {
  addonActive: boolean;
  isPublished: boolean;
  slug: string | null;
  displayName: string | null;
  contactPhone: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
}

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://shop.zarodashop.com").replace(/\/+$/, "");
const NAVY = "#0a1633";
const GOLD = "#c99a2e";

/**
 * A print-ready A4 poster for the shop: a big QR code that opens the shop's own page, with the shop's name
 * and three steps. Printed from the browser ("Save as PDF" works too). The poster is laid out in millimetres
 * so it prints the same on any printer; on screen it is shown smaller.
 */
export default function ShopPosterPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [store, setStore] = useState<OnlineStore | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    setSessionState(s);
    void (async () => {
      try {
        const result = await apiGet<OnlineStore>("/online-store/me");
        setStore(result);
        if (result.slug) {
          setQr(
            await QRCode.toDataURL(`${STOREFRONT_URL}/s/${result.slug}`, {
              errorCorrectionLevel: "H",
              margin: 1,
              width: 1000,
              color: { dark: NAVY, light: "#ffffff" },
            }),
          );
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load your shop.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (!session) return null;

  const isManager = session.role === "MANAGER" || session.role === "OWNER";
  // Posters exist for retail shops and for hotels / restaurants only.
  const kind: "shop" | "menu" | null = session.industryType === "RETAIL" ? "shop" : session.industryType === "RESTAURANT" ? "menu" : null;
  const shopUrl = store?.slug ? `${STOREFRONT_URL}/s/${store.slug}` : null;
  const shopName = store?.displayName ?? "Our shop";
  const ways = [store?.pickupEnabled ? "Pickup" : null, store?.deliveryEnabled ? "Delivery" : null].filter(Boolean).join("  ·  ");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Print only the poster: hide everything else, drop the page margins, keep the colours. */}
      <style>{`
        .poster-zoom { zoom: 0.5; }
        @media (min-width: 640px) { .poster-zoom { zoom: 0.62; } }
        @page { size: A4; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .poster-zoom { zoom: 1; }
          .poster-stage { padding: 0 !important; background: #fff !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="print:hidden">
        <Nav session={session} />
        <PageHeader />
      </div>

      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="space-y-4 print:hidden">
          <h1 className="text-xl font-bold">{kind === "menu" ? "Menu poster" : "Shop poster"}</h1>
          <p className="text-sm text-secondary-500">
            Print this and pin it where your customers pass - at your counter, your gate, a notice board. Anyone who scans the code with their phone camera lands
            on your shop and can see what you have in stock and order.
          </p>
          {!kind && <EmptyState title="Posters are for retail shops and restaurants" description="A QR poster is available for retail shops and for hotels and restaurants." />}
          {loading && <LoadingState label="Preparing your poster..." />}
          {error && <p className="text-sm text-error-600">{error}</p>}
          {!loading && !isManager && <EmptyState title="Owners and managers only" description="Ask your business owner or a manager to print the poster." />}
          {!loading && kind && isManager && store && !store.slug && (
            <EmptyState title="Choose a shop link first" description="Set your shop link in Online Shop settings, then come back to print the poster." />
          )}
          {!loading && kind && isManager && store?.slug && !store.isPublished && (
            <p className="rounded-md border border-warning-600/40 bg-warning-50 p-3 text-sm">
              Your shop is not live yet, so the code will not open anything until you publish it. You can still prepare the poster.
            </p>
          )}
          {!loading && kind && isManager && qr && (
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => window.print()}>
                <Printer size={16} className="mr-2" />
                Print or save as PDF
              </Button>
              <a
                href={qr}
                download={`${store?.slug ?? "shop"}-qr.png`}
                className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary-500/5"
              >
                <Download size={16} className="mr-2" />
                Download the QR code only
              </a>
            </div>
          )}
        </div>

        {kind && isManager && qr && shopUrl && (
          <div className="poster-stage mt-6 flex justify-center bg-secondary-500/10 p-4 print:mt-0 print:block print:bg-white print:p-0">
            <div className="poster-zoom">
              {kind === "menu" ? (
                <MenuPoster qr={qr} shopName={shopName} shopUrl={shopUrl} phone={store?.contactPhone ?? null} />
              ) : (
              <div
                style={{
                  width: "210mm",
                  height: "297mm",
                  background: "#ffffff",
                  color: NAVY,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
                }}
              >
                {/* Header */}
                <div style={{ background: NAVY, padding: "12mm 14mm 9mm", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed brand asset */}
                  <img src="/zaroda-logo-white.png" alt="Zaroda" style={{ height: "24mm", width: "auto" }} />
                  <div style={{ textAlign: "right", color: GOLD }}>
                    <div style={{ fontSize: "9mm", fontWeight: 800, letterSpacing: "1mm", lineHeight: 1 }}>SHOP ONLINE</div>
                    <div style={{ fontSize: "4.2mm", color: "#ffffff", marginTop: "2.5mm" }}>Pickup &amp; delivery · Pay with M-Pesa</div>
                  </div>
                </div>
                <div style={{ height: "3mm", background: GOLD }} />

                {/* Shop name */}
                <div style={{ textAlign: "center", padding: "11mm 14mm 0" }}>
                  <div style={{ fontSize: "4.6mm", letterSpacing: "1.2mm", textTransform: "uppercase", color: GOLD, fontWeight: 700 }}>Welcome to</div>
                  <div
                    style={{
                      fontSize: shopName.length > 26 ? "11mm" : shopName.length > 16 ? "14mm" : "18mm",
                      fontWeight: 800,
                      lineHeight: 1.05,
                      marginTop: "2mm",
                      wordBreak: "break-word",
                    }}
                  >
                    {shopName}
                  </div>
                  <div style={{ fontSize: "5.4mm", marginTop: "4mm", color: "#334155" }}>See what we have in stock and order from your phone.</div>
                </div>

                {/* QR */}
                <div style={{ display: "flex", justifyContent: "center", padding: "8mm 0 4mm" }}>
                  <div style={{ border: `3mm solid ${GOLD}`, borderRadius: "8mm", padding: "5mm", background: "#ffffff" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
                    <img src={qr} alt={`QR code for ${shopName}`} style={{ width: "98mm", height: "98mm", display: "block" }} />
                  </div>
                </div>
                <div style={{ textAlign: "center", fontSize: "6mm", fontWeight: 800 }}>SCAN WITH YOUR PHONE CAMERA</div>
                <div style={{ textAlign: "center", fontSize: "4.4mm", color: "#475569", marginTop: "1mm" }}>Changanua kwa simu yako ununue</div>

                {/* Steps */}
                <div style={{ display: "flex", gap: "6mm", padding: "9mm 14mm 0" }}>
                  {[
                    ["1", "Scan", "Point your camera at the code"],
                    ["2", "Choose", "Pick what you want to buy"],
                    ["3", "Pay", "Pay safely with M-Pesa"],
                  ].map(([n, title, text]) => (
                    <div key={n} style={{ flex: 1, textAlign: "center" }}>
                      <div
                        style={{
                          width: "13mm",
                          height: "13mm",
                          borderRadius: "50%",
                          background: NAVY,
                          color: GOLD,
                          fontSize: "7mm",
                          fontWeight: 800,
                          lineHeight: "13mm",
                          margin: "0 auto",
                        }}
                      >
                        {n}
                      </div>
                      <div style={{ fontSize: "5.2mm", fontWeight: 800, marginTop: "2.5mm" }}>{title}</div>
                      <div style={{ fontSize: "3.8mm", color: "#475569", marginTop: "1mm" }}>{text}</div>
                    </div>
                  ))}
                </div>

                {/* Link and contact */}
                <div style={{ textAlign: "center", marginTop: "auto", padding: "0 14mm 8mm" }}>
                  <div style={{ fontSize: "5mm", fontWeight: 800 }}>{shopUrl.replace(/^https?:\/\//, "")}</div>
                  {(store?.contactPhone || ways) && (
                    <div style={{ fontSize: "4.2mm", color: "#475569", marginTop: "2mm" }}>
                      {[ways, store?.contactPhone ? `Call ${store.contactPhone}` : null].filter(Boolean).join("   ·   ")}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div style={{ background: NAVY, color: "#cbd5e1", textAlign: "center", fontSize: "3.6mm", padding: "4.5mm 10mm" }}>
                  Powered by <strong style={{ color: "#ffffff" }}>ZARODA SOLUTIONS</strong> - Innovative. Reliable. Forward.
                </div>
              </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** The restaurant / hotel version: "scan, view our menu and order right here". Same A4 size and QR as the shop poster. */
function MenuPoster({ qr, shopName, shopUrl, phone }: { qr: string; shopName: string; shopUrl: string; phone: string | null }) {
  return (
    <div
      style={{
        width: "210mm",
        height: "297mm",
        background: "#ffffff",
        color: NAVY,
        fontFamily: "Arial, Helvetica, sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ background: NAVY, padding: "11mm 14mm 8mm", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed brand asset */}
        <img src="/zaroda-logo-white.png" alt="Zaroda" style={{ height: "22mm", width: "auto" }} />
        <div style={{ textAlign: "right", color: GOLD }}>
          <div style={{ fontSize: "8.5mm", fontWeight: 800, letterSpacing: "0.6mm", lineHeight: 1 }}>DIGITAL MENU</div>
          <div style={{ fontSize: "4mm", color: "#ffffff", marginTop: "2mm" }}>for hotels &amp; restaurants</div>
          <div style={{ fontSize: "3.8mm", color: "#cbd5e1", marginTop: "1mm" }}>Scan · Browse · Order · Enjoy</div>
        </div>
      </div>
      <div style={{ height: "3mm", background: GOLD }} />

      <div style={{ textAlign: "center", padding: "10mm 14mm 0" }}>
        <div style={{ fontSize: "17mm", fontStyle: "italic", fontWeight: 800, lineHeight: 1 }}>Hungry?</div>
        <div style={{ fontSize: "8.5mm", fontWeight: 800, lineHeight: 1.1, marginTop: "4mm" }}>
          SCAN, VIEW OUR MENU
          <br />
          <span style={{ color: GOLD }}>AND ORDER RIGHT HERE</span>
        </div>
        <div style={{ fontSize: "4.6mm", marginTop: "4mm", color: "#334155" }}>No need to call. No waiting. Just scan and enjoy.</div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "10mm", padding: "7mm 14mm 0", fontSize: "3.8mm", fontWeight: 700 }}>
        {["Quick ordering", "Full menu with photos", "Fresh meals at your table"].map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
            <span style={{ width: "4mm", height: "4mm", borderRadius: "50%", background: GOLD, display: "inline-block" }} />
            {t}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "center", padding: "8mm 0 0" }}>
        <div style={{ background: NAVY, borderRadius: "6mm", padding: "7mm 9mm 8mm", textAlign: "center", color: "#ffffff", width: "118mm" }}>
          <div style={{ color: GOLD, fontSize: "8mm", fontWeight: 800, letterSpacing: "0.8mm" }}>OUR MENU</div>
          <div style={{ border: `2.5mm solid ${GOLD}`, borderRadius: "5mm", padding: "4mm", background: "#ffffff", margin: "4mm auto 0", width: "88mm" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            <img src={qr} alt={`QR code for ${shopName}`} style={{ width: "80mm", height: "80mm", display: "block" }} />
          </div>
          <div style={{ fontSize: "6.4mm", fontWeight: 800, marginTop: "5mm" }}>SCAN HERE</div>
          <div style={{ fontSize: "4.2mm", color: "#cbd5e1", marginTop: "1mm" }}>to view our menu and place your order</div>
          <div style={{ fontSize: "3.6mm", color: GOLD, marginTop: "2mm", fontWeight: 700 }}>Changanua kwa simu yako uone menyu</div>
        </div>
      </div>

      <div style={{ textAlign: "center", padding: "6mm 14mm 0" }}>
        <div style={{ fontSize: shopName.length > 26 ? "7mm" : "10mm", fontWeight: 800, lineHeight: 1.05, wordBreak: "break-word" }}>{shopName}</div>
        <div style={{ fontSize: "4.4mm", fontWeight: 700, marginTop: "2mm" }}>{shopUrl.replace(/^https?:\/\//, "")}</div>
        {phone && <div style={{ fontSize: "4mm", color: "#475569", marginTop: "1mm" }}>Call {phone}</div>}
      </div>

      <div style={{ display: "flex", gap: "6mm", padding: "7mm 14mm 0", marginTop: "auto" }}>
        {[
          ["1", "Scan", "Open your phone camera and scan the QR code"],
          ["2", "Browse", "Explore our menu with photos"],
          ["3", "Order", "Add your favourites and place your order"],
        ].map(([n, title, text]) => (
          <div key={n} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ width: "12mm", height: "12mm", borderRadius: "50%", background: NAVY, color: GOLD, fontSize: "6.5mm", fontWeight: 800, lineHeight: "12mm", margin: "0 auto" }}>{n}</div>
            <div style={{ fontSize: "5mm", fontWeight: 800, marginTop: "2mm" }}>{title}</div>
            <div style={{ fontSize: "3.6mm", color: "#475569", marginTop: "1mm" }}>{text}</div>
          </div>
        ))}
      </div>

      <div style={{ background: NAVY, color: "#cbd5e1", textAlign: "center", fontSize: "3.6mm", padding: "4.5mm 10mm", marginTop: "8mm" }}>
        Fresh &amp; delicious meals · Fast &amp; convenient · Powered by <strong style={{ color: "#ffffff" }}>ZARODA SOLUTIONS</strong>
      </div>
    </div>
  );
}
