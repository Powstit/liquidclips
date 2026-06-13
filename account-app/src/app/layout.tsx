import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { RouteSplash } from "@/components/RouteSplash";
import { PostHogBoot } from "@/components/PostHogBoot";
import { WhopLinkBoot } from "@/components/WhopLinkBoot";
import { ServiceWorkerBoot } from "@/components/ServiceWorkerBoot";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Liquid Clips — your account",
  description: "Manage your Liquid Clips subscription, download the app, view your usage.",
  applicationName: "Liquid Clips",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Liquid Clips",
  },
  icons: {
    apple: "/brand/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0F",
};

// v0.7.57 — Clerk primary swap. Clerk's primary domain is now liquidclips.app
// (was account.jnremployee.com). Customer auth (sign-in, sign-up, dashboard,
// connect-desktop, upgrade, checkout) is served at the bare apex via a
// marketing-edge Next.js rewrite (`liquidclips-marketing/next.config.ts`)
// that proxies those paths to this account-app project. The user's URL bar
// reads `liquidclips.app` end-to-end. account.liquidclips.app stays as a
// satellite alias for legacy direct hits; client-side Clerk JS auto-detects
// satellite mode from the publishable key on those direct hits. No
// server-side satellite branching is needed anymore: the page always
// renders in standard primary mode, and Clerk JS adjusts on the client
// based on `window.location.host`.

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      allowedRedirectOrigins={["https://liquidclips.app", "https://account.liquidclips.app"]}
      // Billing is in Beta — version locked via exact-pin in package.json
      // (`"@clerk/nextjs": "7.3.7"`, no caret). clerk-js follows the SDK version
      // at runtime, so the npm pin is sufficient. See clerk.com/docs/pinning.
      appearance={{
        variables: {
          colorPrimary: "#FF1A8C",
          colorBackground: "#FAF7F2",
          colorText: "#0A0A0F",
          colorTextSecondary: "#5A5560",
          colorInputBackground: "#FAF7F2",
          colorInputText: "#0A0A0F",
          borderRadius: "10px",
          fontFamily: "var(--font-geist)",
          fontFamilyButtons: "var(--font-geist)",
        },
        elements: {
          card: "border border-line shadow-[0_10px_40px_rgba(10,10,15,0.04)]",
          headerTitle: "font-[var(--font-geist)] font-bold tracking-[-0.025em]",
          formButtonPrimary: "bg-ink hover:bg-fuchsia transition-colors",
          socialButtonsBlockButton: "border border-line hover:border-fuchsia",
        },
      }}
    >
      <html
        lang="en"
        className={`${fraunces.variable} ${geist.variable} ${geistMono.variable} antialiased`}
      >
        <body className="flex min-h-screen flex-col bg-paper text-ink">
          <PostHogBoot />
          <WhopLinkBoot />
          <ServiceWorkerBoot />
          <Nav />
          <main className="flex-1">{children}</main>
          <RouteSplash />
        </body>
      </html>
    </ClerkProvider>
  );
}
