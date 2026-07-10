import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./lib/AuthProvider";

// Distinctive display (Bricolage Grotesque) for headlines, paired with a clean,
// characterful body (Plus Jakarta Sans).
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NeighborhoodIQ — the honest neighborhood dashboard",
  description:
    "Real Zillow home-value data for every U.S. metro ZIP code: what homes cost, whether prices are rising or cooling, and how each place compares to its metro — plus an honest read on the risk.",
  openGraph: {
    title: "NeighborhoodIQ — the honest neighborhood dashboard",
    description:
      "Real home-value trends, comparisons, and an honest risk read for 20,000+ U.S. metro ZIP codes. No hype, no crystal ball.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbfbfc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
