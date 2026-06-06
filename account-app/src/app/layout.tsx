import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { RouteSplash } from "@/components/RouteSplash";
import { PostHogBoot } from "@/components/PostHogBoot";
import { WhopLinkBoot } from "@/components/WhopLinkBoot";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Liquid Clips — your account",
  description: "Manage your Liquid Clips subscription, download the app, view your usage.",
};

// v0.7.x — satellite domain support. The SAME Next.js app serves both
// `account.jnremployee.com` (primary) and `account.liquidclips.app`
// (satellite). The host header decides which mode Clerk operates in:
//   • Primary domain → standard ClerkProvider, sign-in lives here.
//   • Satellite domain → isSatellite=true, sign-in redirects to primary,
//     session syncs back via __clerk_synced.
// Primary stays jnremployee.com for now to avoid forcing existing users
// to re-auth; new sign-ups happening on liquidclips.app still complete
// against primary then redirect back — branding-clean inside emails
// because Clerk's app.name is "Liquid Clips" everywhere.
const PRIMARY_HOST = "account.jnremployee.com";
const SATELLITE_HOSTS = ["account.liquidclips.app"];
const PRIMARY_URL = "https://account.jnremployee.com";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  const isSatellite = SATELLITE_HOSTS.includes(host);
  const satelliteProps = isSatellite
    ? {
        isSatellite: true as const,
        domain: host,
        signInUrl: `${PRIMARY_URL}/sign-in`,
        signUpUrl: `${PRIMARY_URL}/sign-up`,
      }
    : {
        allowedRedirectOrigins: SATELLITE_HOSTS.map((h) => `https://${h}`),
      };

  // Suppress unused-var warning if host detection ever bails; PRIMARY_HOST
  // documents intent for future swap to liquidclips.app as primary.
  void PRIMARY_HOST;
  return (
    <ClerkProvider
      {...satelliteProps}
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
          headerTitle: "font-[var(--font-fraunces)] tracking-[-0.025em]",
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
          <Nav />
          <main className="flex-1">{children}</main>
          <RouteSplash />
        </body>
      </html>
    </ClerkProvider>
  );
}
