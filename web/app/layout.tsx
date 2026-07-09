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
  title: "NeighborhoodIQ",
  description:
    "A model trained on a decade of Zillow home values, forecasting where appreciation is most likely over the next five years, for every metro ZIP code in the U.S.",
  openGraph: {
    title: "NeighborhoodIQ",
    description:
      "Forward-looking 5-year appreciation forecasts for 20,000+ U.S. metro ZIP codes.",
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
