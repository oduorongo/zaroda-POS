import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZARODA POS Back Office",
  description: "Owner/manager admin console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
