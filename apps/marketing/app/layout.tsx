import type { Metadata } from "next";
import "./globals.css";
import Nav from "../components/nav";
import Footer from "../components/footer";

const TITLE = "Zaroda POS — Point of Sale for Kenyan Retail";
const DESCRIPTION =
  "Rent-to-run POS for supermarkets, minimarts, pharmacies, agrovets, and more — M-Pesa built in, works offline.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL("https://zarodashop.com"),
  keywords: ["M-Pesa POS", "Kenya point of sale", "retail software Kenya", "eTIMS POS", "offline POS", "supermarket POS Kenya"],
  robots: { index: true, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://zarodashop.com",
    siteName: "Zaroda POS",
    type: "website",
    locale: "en_KE",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
