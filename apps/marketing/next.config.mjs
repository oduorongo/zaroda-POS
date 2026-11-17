/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@zaroda/ui"],
  // next/image is not used: switching the optimizer off closes /_next/image (several RCE advisories live there).
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
