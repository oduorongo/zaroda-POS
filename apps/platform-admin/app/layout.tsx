import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZARODA Platform Admin",
  description: "Cross-tenant platform administration - not a tenant console",
};

// Deliberately a different color scheme (zinc/black) from apps/backoffice's
// slate palette - a platform admin and a tenant owner logging into two
// different apps in adjacent browser tabs should be able to tell them
// apart at a glance, on top of the session storage itself already being
// namespaced separately (lib/auth.ts) and the tokens being structurally
// incompatible with each other's API.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
