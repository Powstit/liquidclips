// HQ Agent 5 · /admin/recovery — break-glass identity-proof landing.
//
// This page is the ONLY admin surface that must remain reachable when the
// regular admin gate (IP allowlist + email allowlist + MFA claim) has
// blocked Daniel. By definition, an admin doing recovery has lost their
// session and possibly their device, so we don't gate this server-side.
//
// <!-- TODO Agent 1: exempt /admin/recovery from the IP+email gate in
//      src/middleware.ts. The path must reach this server component
//      WITHOUT enforcing the master-allowlist redirect — otherwise a
//      locked-out admin can never run recovery. -->
//
// Renders the client-side <RecoveryForm /> which POSTs to
// /api/admin/recovery/verify. On success the form swaps itself for the
// <SuccessPanel /> with the freshly minted TOTP seed + backup codes.

import Image from "next/image";
import { RecoveryForm } from "./RecoveryForm";

export const dynamic = "force-dynamic";

// Tell crawlers + LLMs to ignore this surface. The recovery URL is meant to
// be a private bookmark, not something Daniel discovers through Google.
export const metadata = {
  title: "Liquid Clips · HQ Recovery",
  description: "Restricted recovery surface.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RecoveryPage() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto max-w-2xl px-6 py-12 sm:py-20">
        <header className="mb-10 flex flex-col items-center text-center">
          <Image
            src="/brand/logo-monogram.png"
            alt="Liquid Clips"
            width={56}
            height={56}
            priority
            className="mb-5 rounded-md"
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-fuchsia-deep">
            Liquid Clips · HQ
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Recovery
          </h1>
          <p className="mt-3 max-w-md text-sm text-text-secondary">
            Use this if you&apos;ve lost access to your admin account. You&apos;ll
            need three of the master emails, your 6-digit recovery PIN, and
            your 8-character auth code. On success a fresh TOTP seed and
            backup codes are issued — once.
          </p>
        </header>

        <RecoveryForm />

        <footer className="mt-12 border-t border-line pt-6 text-center text-xs text-text-tertiary">
          <p>
            Three failed attempts from this IP lock recovery for 24 hours.
            Each successful run replaces your TOTP seed, invalidating any
            authenticator app entry that still holds the old one.
          </p>
        </footer>
      </div>
    </main>
  );
}
