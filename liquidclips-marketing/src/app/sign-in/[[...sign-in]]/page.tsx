// v0.7.59 — Native /sign-in on the Clerk primary domain (liquidclips.app).
//
// Replaces the prior next.config.ts rewrite to account-app, which served
// the page HTML through liquidclips.app but left every /_next/static/*
// asset 404-ing on the marketing apex. The result was a white unstyled
// Clerk widget.
//
// This page renders the Clerk SignIn widget natively in the marketing app
// so all its CSS/JS resolves against the same Vercel deployment. The
// optional ?redirect=… search param lets the desktop /connect-desktop
// page point users here and route them back after they sign in.

import { SignIn } from "@clerk/nextjs";

type SearchParams = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function ensureSafeRedirect(raw: string | null): string {
  if (!raw) return "/connect-desktop";
  // Allow same-origin relative paths only — refuse absolute URLs so an open
  // redirect can't be chained through the sign-in flow.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/connect-desktop";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const redirect = ensureSafeRedirect(firstString(sp.redirect));
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-paper px-6 py-12">
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          sign in
        </div>
        <span
          aria-hidden
          className="inline-grid h-[44px] w-[44px] place-items-center rounded-lg bg-fuchsia font-mono text-[22px] font-bold leading-none text-paper"
        >
          /
        </span>
        <h1 className="max-w-[460px] text-center font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          Sign in to Liquid Clips.
        </h1>
      </div>
      <SignIn
        routing="hash"
        signUpUrl={`/sign-up?redirect=${encodeURIComponent(redirect)}`}
        forceRedirectUrl={redirect}
        signUpForceRedirectUrl={redirect}
      />
    </div>
  );
}
