import type { Metadata } from "next";
import TenantPortal from "../../components/tenant-portal";

export const metadata: Metadata = { title: "My rent account", robots: { index: false } };

export default function TenantPage() {
  return <TenantPortal />;
}
