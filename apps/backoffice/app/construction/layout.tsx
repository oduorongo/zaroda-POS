import type { Metadata } from "next";

export const metadata: Metadata = { title: "Zaroda Build", description: "Construction ERP: projects, sites, compliance and accounts" };

export default function ConstructionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
