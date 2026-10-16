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

type PosterKind = "shop" | "menu" | "salon" | "pharmacy";

// Posters exist for retail shops, hotels / restaurants, salons and pharmacies. Salons point at the booking page,
// the rest at the shop's online page.
const KIND_BY_INDUSTRY: Record<string, PosterKind> = { RETAIL: "shop", RESTAURANT: "menu", SALON: "salon", PHARMACY: "pharmacy" };
const TITLE: Record<PosterKind, string> = { shop: "Shop poster", menu: "Menu poster", salon: "Booking poster", pharmacy: "Pharmacy poster" };
const WHAT_THEY_SEE: Record<PosterKind, string> = {
  shop: "lands on your shop and can see what you have in stock and order",
  menu: "lands on your menu and can order",
  salon: "lands on your booking page and can choose a service and a time",
  pharmacy: "lands on your pharmacy page and can see your products and order",
};

interface OrgMe {
  id: string;
  name: string;
}
interface BranchRow {
  id: string;
  name: string;
}

/**
 * A print-ready A4 poster with a big QR code that opens the business's own page, laid out in millimetres so it
 * prints the same on any printer (print from the browser; "Save as PDF" works too). Which poster you get depends on
 * the business type: retail shop, restaurant / hotel, salon or pharmacy.
 */
export default function ShopPosterPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [store, setStore] = useState<OnlineStore | null>(null);
  const [org, setOrg] = useState<OrgMe | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
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
    const poster = KIND_BY_INDUSTRY[s.industryType];
    void (async () => {
      try {
        if (poster === "salon") {
          const [me, branchList] = await Promise.all([apiGet<OrgMe>("/organizations/me"), apiGet<BranchRow[]>("/branches")]);
          setOrg(me);
          setBranches(branchList);
          setBranchId(branchList[0]?.id ?? "");
        } else if (poster) {
          setStore(await apiGet<OnlineStore>("/online-store/me"));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load your details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const kind: PosterKind | null = session ? (KIND_BY_INDUSTRY[session.industryType] ?? null) : null;
  const targetUrl =
    kind === "salon"
      ? org && branchId && typeof window !== "undefined"
        ? `${window.location.origin}/book/${org.id}/${branchId}`
        : null
      : store?.slug
        ? `${STOREFRONT_URL}/s/${store.slug}`
        : null;

  useEffect(() => {
    if (!targetUrl) {
      setQr(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(targetUrl, { errorCorrectionLevel: "H", margin: 1, width: 1000, color: { dark: NAVY, light: "#ffffff" } }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [targetUrl]);

  if (!session) return null;

  const isManager = session.role === "MANAGER" || session.role === "OWNER";
  const shopUrl = targetUrl;
  const shopName = (kind === "salon" ? (org?.name ?? session.orgName) : store?.displayName) ?? (kind === "salon" ? "Our salon" : "Our shop");
  const ways = [store?.pickupEnabled ? "Pickup" : null, store?.deliveryEnabled ? "Delivery" : null].filter(Boolean).join("  ·  ");
  const phone = store?.contactPhone ?? null;

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
          <h1 className="text-xl font-bold">{kind ? TITLE[kind] : "Poster"}</h1>
          {kind && (
            <p className="text-sm text-secondary-500">
              Print this and pin it where your customers pass - at your counter, your gate, a notice board. Anyone who scans the code with their phone camera {WHAT_THEY_SEE[kind]}.
            </p>
          )}
          {!kind && <EmptyState title="Posters are not available for this business type" description="QR posters are available for retail shops, hotels and restaurants, salons and pharmacies." />}
          {loading && kind && <LoadingState label="Preparing your poster..." />}
          {error && <p className="text-sm text-error-600">{error}</p>}
          {!loading && kind && !isManager && <EmptyState title="Owners and managers only" description="Ask your business owner or a manager to print the poster." />}
          {!loading && kind && kind !== "salon" && isManager && store && !store.slug && (
            <EmptyState title="Choose a shop link first" description="Set your shop link in Online Shop settings, then come back to print the poster." />
          )}
          {!loading && kind && kind !== "salon" && isManager && store?.slug && !store.isPublished && (
            <p className="rounded-md border border-warning-600/40 bg-warning-50 p-3 text-sm">
              Your shop is not live yet, so the code will not open anything until you publish it. You can still prepare the poster.
            </p>
          )}
          {!loading && kind === "salon" && isManager && branches.length > 1 && (
            <label className="block text-sm">
              Which branch should the code book?
              <select className="mt-1 block rounded-md border border-border bg-background p-2" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!loading && kind === "salon" && isManager && branches.length === 0 && <EmptyState title="Add a branch first" description="The booking page belongs to a branch." />}
          {!loading && kind && isManager && qr && (
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => window.print()}>
                <Printer size={16} className="mr-2" />
                Print or save as PDF
              </Button>
              <a
                href={qr}
                download={`${store?.slug ?? "poster"}-qr.png`}
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
                <MenuPoster qr={qr} shopName={shopName} shopUrl={shopUrl} phone={phone} />
              ) : kind === "salon" ? (
                <SalonPoster qr={qr} shopName={shopName} shopUrl={shopUrl} />
              ) : kind === "pharmacy" ? (
                <PharmacyPoster qr={qr} shopName={shopName} shopUrl={shopUrl} phone={phone} ways={ways} />
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

const POSTER_BOX = {
  width: "210mm",
  height: "297mm",
  background: "#ffffff",
  color: NAVY,
  fontFamily: "Arial, Helvetica, sans-serif",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
} as const;

/** Shared blue-and-gold top band: the Zaroda logo on the left, the poster's title and tagline on the right. */
function PosterHeader({ title, subtitle, tagline }: { title: string; subtitle?: string; tagline: string }) {
  return (
    <>
      <div style={{ background: NAVY, padding: "11mm 14mm 8mm", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed brand asset */}
        <img src="/zaroda-logo-white.png" alt="Zaroda" style={{ height: "22mm", width: "auto" }} />
        <div style={{ textAlign: "right", color: GOLD }}>
          <div style={{ fontSize: "8.5mm", fontWeight: 800, letterSpacing: "0.6mm", lineHeight: 1.05 }}>{title}</div>
          {subtitle && <div style={{ fontSize: "4.4mm", color: "#ffffff", marginTop: "2mm", fontWeight: 700 }}>{subtitle}</div>}
          <div style={{ fontSize: "3.8mm", color: "#cbd5e1", marginTop: "1mm" }}>{tagline}</div>
        </div>
      </div>
      <div style={{ height: "3mm", background: GOLD }} />
    </>
  );
}

/** A navy card with the QR in a gold frame, headed by `heading` and captioned with `caption`. */
function QrCard({ qr, heading, caption, sub }: { qr: string; heading: string; caption: string; sub?: string }) {
  return (
    <div style={{ background: NAVY, borderRadius: "6mm", padding: "6mm 9mm 7mm", textAlign: "center", color: "#ffffff", width: "112mm" }}>
      <div style={{ color: GOLD, fontSize: "7.5mm", fontWeight: 800, letterSpacing: "0.6mm" }}>{heading}</div>
      <div style={{ fontSize: "4.2mm", marginTop: "1mm" }}>{caption}</div>
      <div style={{ border: `2.5mm solid ${GOLD}`, borderRadius: "5mm", padding: "4mm", background: "#ffffff", margin: "4mm auto 0", width: "84mm" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        <img src={qr} alt="QR code" style={{ width: "76mm", height: "76mm", display: "block" }} />
      </div>
      {sub && <div style={{ fontSize: "3.6mm", color: GOLD, marginTop: "3mm", fontWeight: 700, letterSpacing: "0.4mm" }}>{sub}</div>}
    </div>
  );
}

function StepsRow({ steps }: { steps: [string, string, string][] }) {
  return (
    <div style={{ display: "flex", gap: "6mm", padding: "6mm 14mm 0", marginTop: "auto" }}>
      {steps.map(([n, title, text]) => (
        <div key={n} style={{ flex: 1, textAlign: "center" }}>
          <div style={{ width: "12mm", height: "12mm", borderRadius: "50%", background: NAVY, color: GOLD, fontSize: "6.5mm", fontWeight: 800, lineHeight: "12mm", margin: "0 auto" }}>{n}</div>
          <div style={{ fontSize: "5mm", fontWeight: 800, marginTop: "2mm" }}>{title}</div>
          <div style={{ fontSize: "3.6mm", color: "#475569", marginTop: "1mm" }}>{text}</div>
        </div>
      ))}
    </div>
  );
}

function FooterBand({ items }: { items: string[] }) {
  return (
    <div style={{ background: NAVY, color: "#e2e8f0", display: "flex", justifyContent: "space-around", gap: "4mm", fontSize: "3.4mm", fontWeight: 700, textAlign: "center", padding: "5mm 8mm", marginTop: "7mm" }}>
      {items.map((t) => (
        <span key={t} style={{ flex: 1 }}>
          {t}
        </span>
      ))}
    </div>
  );
}

function Chips({ items, align = "center" }: { items: string[]; align?: "center" | "left" }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", gap: "3mm 9mm", padding: "6mm 14mm 0", fontSize: "3.9mm", fontWeight: 700 }}>
      {items.map((t) => (
        <div key={t} style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
          <span style={{ width: "4mm", height: "4mm", borderRadius: "50%", background: GOLD, display: "inline-block" }} />
          {t}
        </div>
      ))}
    </div>
  );
}

/** Salon / beauty: "book your service right from your phone". The code opens the branch's booking page. */
function SalonPoster({ qr, shopName, shopUrl }: { qr: string; shopName: string; shopUrl: string }) {
  return (
    <div style={POSTER_BOX}>
      <PosterHeader title="ONLINE BOOKING" subtitle="for salons & beauty spas" tagline="Scan · Choose · Book · Be beautiful" />
      <div style={{ textAlign: "center", padding: "9mm 14mm 0" }}>
        <div style={{ fontSize: "4.6mm", letterSpacing: "1.4mm", fontWeight: 700 }}>LOOKING GREAT?</div>
        <div style={{ fontSize: "15mm", fontWeight: 800, lineHeight: 1.0, marginTop: "2mm" }}>BOOK YOUR</div>
        <div style={{ fontSize: "15mm", fontWeight: 800, lineHeight: 1.0, color: GOLD }}>SALON SERVICE</div>
        <div style={{ fontSize: "7mm", fontWeight: 800, marginTop: "2mm" }}>RIGHT FROM YOUR PHONE</div>
        <div style={{ fontSize: "4.4mm", marginTop: "4mm", color: "#334155", lineHeight: 1.35 }}>
          Scan the QR code, choose your service, pick a time and book instantly. It&apos;s fast, easy and convenient!
        </div>
      </div>
      <Chips items={["No calling, no waiting", "Choose your preferred time", "View services and prices", "Confirmed instantly"]} />
      <div style={{ display: "flex", justifyContent: "center", padding: "7mm 0 0" }}>
        <QrCard qr={qr} heading="OUR SERVICES" caption="Scan to view & book" sub="BEAUTY  ·  CARE  ·  CONFIDENCE" />
      </div>
      <div style={{ textAlign: "center", padding: "5mm 14mm 0" }}>
        <div style={{ fontSize: shopName.length > 26 ? "7mm" : "9.5mm", fontWeight: 800, lineHeight: 1.05 }}>{shopName}</div>
        <div style={{ fontSize: "3.8mm", color: "#475569", marginTop: "1.5mm", wordBreak: "break-all" }}>{shopUrl.replace(/^https?:\/\//, "")}</div>
      </div>
      <StepsRow steps={[["1", "Scan", "Open your phone camera and scan the QR code"], ["2", "Choose", "Select your service and preferred time"], ["3", "Book", "Confirm and get instant booking"]]} />
      <FooterBand items={["Professional services", "Affordable prices", "Safe & hygienic environment", "Look good, feel confident"]} />
    </div>
  );
}

/** Pharmacy: "need medicines or health products? scan, view our products and order". */
function PharmacyPoster({ qr, shopName, shopUrl, phone, ways }: { qr: string; shopName: string; shopUrl: string; phone: string | null; ways: string }) {
  return (
    <div style={POSTER_BOX}>
      <PosterHeader title="ORDER FROM OUR PHARMACY" tagline="Scan · Browse · Order · Collect or get delivery" />
      <div style={{ textAlign: "center", padding: "9mm 14mm 0" }}>
        <div style={{ fontSize: "13mm", fontWeight: 800, lineHeight: 1.0 }}>Need Medicines or</div>
        <div style={{ fontSize: "13mm", fontWeight: 800, lineHeight: 1.05, color: GOLD }}>Health Products?</div>
        <div style={{ background: NAVY, color: "#ffffff", borderRadius: "5mm", fontSize: "5.2mm", fontWeight: 700, padding: "4mm 8mm", margin: "6mm auto 0", maxWidth: "150mm", lineHeight: 1.3 }}>
          Scan, view our products and order right from your phone.
        </div>
      </div>
      <Chips items={["Prescription & OTC medicines", "Health & wellness", "Personal care", "Baby & maternity care", "Medical supplies"]} />
      <div style={{ display: "flex", justifyContent: "center", padding: "7mm 0 0" }}>
        <QrCard qr={qr} heading="OUR PHARMACY" caption="Scan to view & order" sub="GENUINE PRODUCTS  ·  FAST SERVICE  ·  TRUSTED QUALITY" />
      </div>
      <div style={{ textAlign: "center", padding: "5mm 14mm 0" }}>
        <div style={{ fontSize: shopName.length > 26 ? "7mm" : "9.5mm", fontWeight: 800, lineHeight: 1.05 }}>{shopName}</div>
        <div style={{ fontSize: "3.8mm", color: "#475569", marginTop: "1.5mm" }}>
          {[shopUrl.replace(/^https?:\/\//, ""), ways, phone ? `Call ${phone}` : null].filter(Boolean).join("   ·   ")}
        </div>
      </div>
      <StepsRow steps={[["1", "Scan", "Open your phone camera and scan the QR code"], ["2", "Browse", "Find the medicines or products you need"], ["3", "Order", "Add to cart and place your order"]]} />
      <FooterBand items={["Collect at our pharmacy or get delivery", "Authentic & quality products", "Easy & secure payments (M-Pesa)", "Better health for you and your family"]} />
    </div>
  );
}
