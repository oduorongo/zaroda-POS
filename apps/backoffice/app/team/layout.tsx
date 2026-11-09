import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "ZARODA Team",
  description: "Sales team leaders and members",
  manifest: "/team.webmanifest",
  icons: { icon: "/team-icon-192.png", apple: "/team-icon-192.png" },
  appleWebApp: { capable: true, title: "ZARODA Team", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0f1f45" };

export default function TeamLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
