import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CRTOverlay } from "@/components/CRTOverlay";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://liquidclips.app"),
  title: {
    default: "Liquid Clips — Drop video. Clip. Post. Earn.",
    template: "%s — Liquid Clips",
  },
  description:
    "The arcade for clippers. Turn long streams, podcasts, and livestreams into ready-to-submit clips for Whop Content Rewards. Local-first, signed for Mac, built by a clipper.",
  openGraph: {
    title: "Liquid Clips — Drop video. Clip. Post. Earn.",
    description:
      "The arcade for clippers. Drop a long video, generate captioned clips, submit to Whop campaigns, get paid. Built by a clipper.",
    url: "https://liquidclips.app",
    siteName: "Liquid Clips",
    images: [{ url: "/brand/og-default.png", width: 1536, height: 1024 }],
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Liquid Clips",
    description: "The arcade for clippers.",
    images: ["/brand/og-default.png"],
  },
  icons: {
    icon: "/brand/favicon-source-512.png",
    apple: "/brand/apple-touch-icon-180.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <CRTOverlay />
        {children}
      </body>
    </html>
  );
}
