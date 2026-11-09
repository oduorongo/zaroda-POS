import type { Metadata } from "next";

export const metadata: Metadata = { title: "ZARODA Team", description: "Sales team leaders and members" };

export default function TeamLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
