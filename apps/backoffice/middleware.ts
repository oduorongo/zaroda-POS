import { NextResponse, type NextRequest } from "next/server";

// Host-based product routing (docs/construction/06-domain-routing.md). Same app, two products:
// CONSTRUCTION_DOMAIN serves Construction (its own landing, pricing, login and signup); every other host is the POS back office.
// On localhost (or a phone on the same Wi-Fi), ?product=construction / ?product=pos switches for testing and is remembered in the cookie.
const COOKIE = "zaroda_product";
const CONSTRUCTION_PUBLIC: Record<string, string> = {
  "/": "/construction/welcome",
  "/login": "/construction/login",
  "/register": "/construction/signup",
  "/signup": "/construction/signup",
  "/pricing": "/construction/pricing",
};
const PUBLIC_BACK = Object.fromEntries(Object.entries(CONSTRUCTION_PUBLIC).map(([k, v]) => [v, k]));

const domainOf = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const constructionDomain = domainOf(process.env.CONSTRUCTION_DOMAIN ?? process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN);
  // This computer, or it reached from a phone on the same Wi-Fi (192.168.x.x, 10.x.x.x, 172.16-31.x.x) while testing.
  const isLocal = host === "localhost" || host === "127.0.0.1" || /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
  const { pathname, searchParams } = req.nextUrl;

  let product: "POS" | "CONSTRUCTION" = constructionDomain && host === constructionDomain ? "CONSTRUCTION" : "POS";
  if (isLocal) {
    const asked = searchParams.get("product");
    if (asked === "construction") product = "CONSTRUCTION";
    else if (asked !== "pos" && req.cookies.get(COOKIE)?.value === "CONSTRUCTION") product = "CONSTRUCTION";
  }

  let res: NextResponse;
  if (product === "CONSTRUCTION" && CONSTRUCTION_PUBLIC[pathname]) {
    res = NextResponse.rewrite(new URL(CONSTRUCTION_PUBLIC[pathname], req.url));
  } else if (product === "CONSTRUCTION" && pathname === "/dashboard") {
    res = NextResponse.redirect(new URL("/construction", req.url));
  } else if (product === "POS" && !isLocal && constructionDomain && pathname.startsWith("/construction")) {
    res = NextResponse.redirect(`https://${constructionDomain}${PUBLIC_BACK[pathname] ?? pathname}`);
  } else {
    res = NextResponse.next();
  }
  res.cookies.set(COOKIE, product, { path: "/", sameSite: "lax", secure: !isLocal });
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon|.*\\.[a-z0-9]+$).*)"] };
