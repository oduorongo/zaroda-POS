import type { Metadata } from "next";
import "./globals.css";
import { PoweredByFooter } from "@zaroda/ui";
import StaffAlerts from "../components/staff-alerts";

export const metadata: Metadata = {
  title: "ZARODA POS Back Office",
  description: "Owner/manager admin console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <StaffAlerts />
        <PoweredByFooter />
      </body>
    </html>
  );
}
