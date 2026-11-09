import type { Metadata } from "next";

export const metadata: Metadata = { title: "ZARODA RENTALS", description: "Property management for landlords" };

export default function RentalsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
