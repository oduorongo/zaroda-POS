import { NextResponse, type NextRequest } from "next/server";

// Host-based product routing (docs/construction/06-domain-routing.md, docs/rentals/domain-routing.md). Same app, three products:
// CONSTRUCTION_DOMAIN serves Construction, RENTALS_DOMAIN serves ZARODA RENTALS (each with its own landing, pricing, login and signup);
// every other host is the POS back office. On localhost (or a phone on the same Wi-Fi), ?product=construction / rentals / pos switches
// for testing and is remembered in the cookie.
type Product = "POS" | "CONSTRUCTION" | "RENTALS";
const COOKIE = "zaroda_product";
const PUBLIC: Record<Exclude<Product, "POS">, Record<string, string>> = {
  CONSTRUCTION: {
    "/": "/construction/welcome",
    "/login": "/construction/login",
    "/register": "/construction/signup",
    "/signup": "/construction/signup",
    "/pricing": "/construction/pricing",
    "/portal": "/construction/portal",
    "/guide": "/construction/guide",
  },
  RENTALS: {
    "/": "/rentals/welcome",
    "/login": "/rentals/login",
    "/register": "/rentals/signup",
    "/signup": "/rentals/signup",
    "/pricing": "/rentals/pricing",
    "/guide": "/rentals/guide",
  },
};
const HOME: Record<Exclude<Product, "POS">, string> = { CONSTRUCTION: "/construction", RENTALS: "/rentals" };
const back = (p: Exclude<Product, "POS">) => Object.fromEntries(Object.entries(PUBLIC[p]).map(([k, v]) => [v, k]));

const domainOf = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const domains: Record<Exclude<Product, "POS">, string> = {
    CONSTRUCTION: domainOf(process.env.CONSTRUCTION_DOMAIN ?? process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN),
    RENTALS: domainOf(process.env.RENTALS_DOMAIN ?? process.env.NEXT_PUBLIC_RENTALS_DOMAIN),
  };
  // This computer, or it reached from a phone on the same Wi-Fi (192.168.x.x, 10.x.x.x, 172.16-31.x.x) while testing.
  const isLocal = host === "localhost" || host === "127.0.0.1" || /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
  const { pathname, searchParams } = req.nextUrl;

  let product: Product = domains.CONSTRUCTION && host === domains.CONSTRUCTION ? "CONSTRUCTION" : domains.RENTALS && host === domains.RENTALS ? "RENTALS" : "POS";
  if (isLocal) {
    const asked = searchParams.get("product");
    const remembered = req.cookies.get(COOKIE)?.value;
    if (asked === "construction") product = "CONSTRUCTION";
    else if (asked === "rentals") product = "RENTALS";
    else if (asked !== "pos" && (remembered === "CONSTRUCTION" || remembered === "RENTALS")) product = remembered;
  }

  let res: NextResponse;
  // A product's own paths on the POS domain move to that product's domain (once it has one).
  const elsewhere = product === "POS" && !isLocal ? (["CONSTRUCTION", "RENTALS"] as const).find((p) => domains[p] && pathname.startsWith(HOME[p])) : undefined;
  if (product !== "POS" && PUBLIC[product][pathname]) {
    res = NextResponse.rewrite(new URL(PUBLIC[product][pathname], req.url));
  } else if (product !== "POS" && pathname === "/dashboard") {
    res = NextResponse.redirect(new URL(HOME[product], req.url));
  } else if (elsewhere) {
    res = NextResponse.redirect(`https://${domains[elsewhere]}${back(elsewhere)[pathname] ?? pathname}`);
  } else {
    res = NextResponse.next();
  }
  res.cookies.set(COOKIE, product, { path: "/", sameSite: "lax", secure: !isLocal });
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon|.*\\.[a-z0-9]+$).*)"] };
