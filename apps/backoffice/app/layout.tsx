import type { Metadata } from "next";
import "./globals.css";
import { PoweredByFooter } from "@zaroda/ui";
import StaffAlerts from "../components/staff-alerts";
import RouteGuard from "../components/route-guard";

export const metadata: Metadata = {
  title: "ZARODA POS Back Office",
  description: "Owner/manager admin console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <RouteGuard>{children}</RouteGuard>
        <StaffAlerts />
        <PoweredByFooter />
      </body>
    </html>
  );
}
