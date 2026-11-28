import { NextResponse, type NextRequest } from "next/server";

// Host-based product routing (docs/construction/06-domain-routing.md, docs/rentals/domain-routing.md, docs/farm/06-domain-routing.md).
// Everyone signs in and works on the main address (POS_DOMAIN, e.g. app.zarodashop.com) and gets the menu for their role. The product
// addresses (CONSTRUCTION_DOMAIN, RENTALS_DOMAIN, SHAMBA_DOMAIN) keep only their adverts: landing, pricing, guide, sign-up (and the
// construction client portal); sign-in and every working screen move to the main address. Without POS_DOMAIN set, each address keeps
// working on its own as before. On localhost (or a phone on the same Wi-Fi), ?product=construction / rentals / shamba / pos switches
// for testing and is remembered in the cookie.
type Product = "POS" | "CONSTRUCTION" | "RENTALS" | "SHAMBA";
type Other = Exclude<Product, "POS">;
const COOKIE = "zaroda_product";
const PUBLIC: Record<Other, Record<string, string>> = {
  CONSTRUCTION: {
    "/": "/construction/welcome",
    "/register": "/construction/signup",
    "/signup": "/construction/signup",
    "/pricing": "/construction/pricing",
    "/portal": "/construction/portal",
    "/guide": "/construction/guide",
  },
  SHAMBA: {
    "/": "/shamba/welcome",
    "/register": "/shamba/signup",
    "/signup": "/shamba/signup",
    "/pricing": "/shamba/pricing",
    "/guide": "/shamba/guide",
  },
  RENTALS: {
    "/": "/rentals/welcome",
    "/register": "/rentals/signup",
    "/signup": "/rentals/signup",
    "/pricing": "/rentals/pricing",
    "/guide": "/rentals/guide",
  },
};
const HOME: Record<Other, string> = { CONSTRUCTION: "/construction", RENTALS: "/rentals", SHAMBA: "/shamba" };
const back = (p: Other) => Object.fromEntries(Object.entries(PUBLIC[p]).map(([k, v]) => [v, k]));
// A product's advert pages (and the construction portal's own pages), by their real paths.
const isAdvert = (p: Other, path: string) => Object.values(PUBLIC[p]).some((v) => v !== "/" && (path === v || path.startsWith(`${v}/`)));

// Which product a path belongs to by its folder (/construction, /rentals, /shamba); shop screens belong to none.
const ownerOf = (path: string): Other | undefined =>
  (["CONSTRUCTION", "RENTALS", "SHAMBA"] as const).find((p) => path === HOME[p] || path.startsWith(`${HOME[p]}/`));

const domainOf = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const domains: Record<Other, string> = {
    CONSTRUCTION: domainOf(process.env.CONSTRUCTION_DOMAIN ?? process.env.NEXT_PUBLIC_CONSTRUCTION_DOMAIN),
    RENTALS: domainOf(process.env.RENTALS_DOMAIN ?? process.env.NEXT_PUBLIC_RENTALS_DOMAIN),
    SHAMBA: domainOf(process.env.SHAMBA_DOMAIN ?? process.env.NEXT_PUBLIC_SHAMBA_DOMAIN),
  };
  const mainDomain = domainOf(process.env.POS_DOMAIN ?? process.env.NEXT_PUBLIC_POS_DOMAIN);
  // This computer, or it reached from a phone on the same Wi-Fi (192.168.x.x, 10.x.x.x, 172.16-31.x.x) while testing.
  const isLocal = host === "localhost" || host === "127.0.0.1" || /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
  const { pathname, searchParams, search } = req.nextUrl;

  let product: Product = domains.CONSTRUCTION && host === domains.CONSTRUCTION ? "CONSTRUCTION" : domains.RENTALS && host === domains.RENTALS ? "RENTALS" : domains.SHAMBA && host === domains.SHAMBA ? "SHAMBA" : "POS";
  if (isLocal) {
    const asked = searchParams.get("product");
    const remembered = req.cookies.get(COOKIE)?.value;
    if (asked === "construction") product = "CONSTRUCTION";
    else if (asked === "rentals") product = "RENTALS";
    else if (asked === "shamba") product = "SHAMBA";
    else if (asked !== "pos" && (remembered === "CONSTRUCTION" || remembered === "RENTALS" || remembered === "SHAMBA")) product = remembered;
  }

  // TEAM_DOMAIN (optional) is the sales team app's own address: its front page and /login open the team portal.
  const teamDomain = domainOf(process.env.TEAM_DOMAIN ?? process.env.NEXT_PUBLIC_TEAM_DOMAIN);
  if (teamDomain && host === teamDomain && (pathname === "/" || pathname === "/login")) {
    return NextResponse.rewrite(new URL(pathname === "/" ? "/team" : "/team/login", req.url));
  }

  let res: NextResponse;
  // A product's advert pages on the main address move to that product's address (once it has one); its working screens stay here.
  const elsewhere = product === "POS" && !isLocal ? (["CONSTRUCTION", "RENTALS", "SHAMBA"] as const).find((p) => domains[p] && isAdvert(p, pathname)) : undefined;
  const toMain = product !== "POS" && !isLocal && !!mainDomain && host !== mainDomain;
  // Until POS_DOMAIN is set, another product's pages opened on a product address (a farm on the Build address) move to that product's own address.
  const owner = ownerOf(pathname);
  const stray = product !== "POS" && !isLocal && !mainDomain && owner && owner !== product && domains[owner] ? owner : undefined;
  if (pathname === "/apps") {
    // the installed ZARODA app's front page: every app and the one sign-in, the same on every address
    res = NextResponse.next();
  } else if (stray) {
    res = NextResponse.redirect(`https://${domains[stray]}${back(stray)[pathname] ?? pathname}${search}`);
  } else if (product !== "POS" && PUBLIC[product][pathname]) {
    res = NextResponse.rewrite(new URL(PUBLIC[product][pathname], req.url));
  } else if (product !== "POS" && isAdvert(product, pathname)) {
    res = NextResponse.next();
  } else if (toMain) {
    res = NextResponse.redirect(`https://${mainDomain}${pathname === "/dashboard" ? HOME[product as Other] : pathname}${search}`);
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

// Every page except Next's own files, the favicon and files with an extension (images, fonts). The backslash is doubled so the
// pattern gets a literal dot; with a single one it skipped every path ending in letters, so the routing above only ran on "/".
export const config = { matcher: ["/((?!_next/|favicon|.*\\.[a-z0-9]+$).*)"] };
