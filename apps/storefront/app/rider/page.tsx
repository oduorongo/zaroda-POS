import type { Metadata } from "next";
import RiderPortal from "../../components/rider-portal";

export const metadata: Metadata = { title: "Deliver with Zaroda", robots: { index: false } };

export default function RiderPage() {
  return <RiderPortal />;
}
