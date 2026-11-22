import type { Metadata } from "next";

export const metadata: Metadata = { title: "Zaroda Shamba", description: "Farm management: livestock, crops, feed and sales for Kenyan farms" };

export default function ShambaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
