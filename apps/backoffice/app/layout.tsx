import type { Metadata } from "next";
import "./globals.css";
import { PoweredByFooter } from "@zaroda/ui";
import StaffAlerts from "../components/staff-alerts";
import RouteGuard from "../components/route-guard";
import InstallPrompt from "../components/install-prompt";

export const metadata: Metadata = {
  title: "ZARODA POS Back Office",
  description: "Owner/manager admin console",
  // Installable on phones and computers (components/install-prompt.tsx); the team pages set their own.
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "ZARODA", statusBarStyle: "black-translucent" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <RouteGuard>{children}</RouteGuard>
        <StaffAlerts />
        <InstallPrompt />
        <PoweredByFooter />
      </body>
    </html>
  );
}
