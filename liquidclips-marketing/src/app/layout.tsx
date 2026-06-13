import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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
  // v0.7.59 — Clerk primary domain is liquidclips.app. Marketing now hosts
  // the customer-facing auth routes natively (/sign-in, /sign-up,
  // /connect-desktop) instead of proxying account-app's, which broke when
  // /_next/static/* assets failed to resolve through the marketing apex.
  // See desktop/docs/auth-keychain-invariant.md for the larger context.
  //
  // Appearance mirrors account-app's so the SignIn / SignUp widgets match
  // the arcade brand kit on either host while we transition.
  return (
    <ClerkProvider
      appearance={{
        variables: {
          // Clerk v7 token names. v6 used colorText / colorTextSecondary /
          // colorInputText / colorInputBackground — the v7 surface is
          // colorForeground / colorMutedForeground / colorInputForeground /
          // colorInput. Keep this comment so the next migration doesn't
          // silently lose the brand colors.
          colorPrimary: "#ff1a8c",
          colorBackground: "#0b0b10",
          colorForeground: "#f4f1ea",
          colorMutedForeground: "#c8c4be",
          colorInput: "#15151c",
          colorInputForeground: "#f4f1ea",
          borderRadius: "10px",
          fontFamily: "var(--font-sans)",
          fontFamilyButtons: "var(--font-sans)",
        },
        elements: {
          card: "border border-line bg-paper-warm shadow-[0_10px_40px_rgba(0,0,0,0.4)]",
          headerTitle: "font-display tracking-[-0.025em]",
          formButtonPrimary: "bg-fuchsia hover:bg-fuchsia-bright transition-colors",
          socialButtonsBlockButton: "border border-line hover:border-fuchsia",
        },
      }}
      allowedRedirectOrigins={[
        "https://liquidclips.app",
        "https://account.liquidclips.app",
      ]}
    >
      <html lang="en">
        <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
          <CRTOverlay />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
