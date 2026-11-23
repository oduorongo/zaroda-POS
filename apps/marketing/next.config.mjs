/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@zaroda/ui"],
  // next/image is not used: switching the optimizer off closes /_next/image (several RCE advisories live there).
  images: { unoptimized: true },
  poweredByHeader: false,
  // zarodashop.com/login is the one sign-in for every Zaroda business (shops, Build, Rentals, Shamba); it opens the back office's page.
  async redirects() {
    const app = (process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "https://app.zarodashop.com").replace(/\/+$/, "");
    return ["/login", "/signin", "/sign-in"].map((source) => ({ source, destination: `${app}/login`, permanent: false }));
  },
  // No other site may show these pages in a frame (clickjacking), nor guess file types; links don't leak the page address.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
