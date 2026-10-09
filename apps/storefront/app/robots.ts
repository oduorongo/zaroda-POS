import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shop.zarodashop.com";

// Shops and the home page are meant to be found; personal pages aren't.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/orders", "/s/*/checkout"] },
    host: SITE_URL,
  };
}
