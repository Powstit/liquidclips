import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/Nav";
import { RouteSplash } from "@/components/RouteSplash";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "junior/employee — your account",
  description: "Manage your Junior subscription, download the app, view your usage.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
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
          <Nav />
          <main className="flex-1">{children}</main>
          <RouteSplash />
        </body>
      </html>
    </ClerkProvider>
  );
}
