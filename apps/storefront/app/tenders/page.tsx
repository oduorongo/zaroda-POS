import type { Metadata } from "next";
import TenderPortal from "../../components/tender-portal";

export const metadata: Metadata = { title: "Post a tender advert", description: "Schools: tell school suppliers what you want to buy." };

export default function TendersPage() {
  return <TenderPortal />;
}
