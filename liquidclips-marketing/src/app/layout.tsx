import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://liquidclips.app"),
  title: {
    default: "Liquid Clips — Your AI editor. Lives on your computer.",
    template: "%s — Liquid Clips",
  },
  description:
    "Turn long videos and Whop Content Rewards into captioned, ready-to-post clips. Local-first desktop editing with Pro hosted AI when you need it.",
  openGraph: {
    title: "Liquid Clips",
    description:
      "Your AI editor. Lives on your computer. Generate captioned clips, publish, schedule, and earn from Whop Content Rewards.",
    url: "https://liquidclips.app",
    siteName: "Liquid Clips",
    images: [{ url: "/og-product.png", width: 1200, height: 630 }],
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Liquid Clips",
    description: "Your AI editor. Lives on your computer.",
    images: ["/og-product.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}>
        {children}
      </body>
    </html>
  );
}
