"use client";

/**
 * Secondary sign-in path on /connect-desktop — the Clerk fallback. Renders
 * BELOW the Whop primary CTA per memory `liquid-clips-whop-lead-decision`:
 * "Clerk stays as SECONDARY sign-in door."
 *
 * Two presentation modes:
 *   - `mode="cta"`   — Quiet outline button. The user has to click to reveal
 *                     the inline Clerk widget. Reduces visual competition
 *                     with the Whop primary on the initial fold.
 *   - `mode="open"`  — Embedded Clerk SignIn rendered directly. Used when
 *                     the user has dismissed Whop (e.g. cancelled, no
 *                     membership) and we want the fallback immediately
 *                     available without a second click.
 */

import { useState } from "react";
import { SignIn } from "@clerk/nextjs";

type Props = {
  /** Where Clerk should land after successful sign-in. Should be the same
   *  /connect-desktop?challenge=… URL the user is currently on so the
   *  activation can resume. */
  backUrl: string;
  /** How prominent to make the Clerk surface. Defaults to "cta" (collapsed). */
  mode?: "cta" | "open";
};

export function ClerkFallbackBlock({ backUrl, mode = "cta" }: Props) {
  const [revealed, setRevealed] = useState(mode === "open");

  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-3">
      {/* Visual divider — quiet typographic break between Whop primary and
          Clerk fallback. Single line, no heavy weight, no "OR" pill. */}
      <div className="flex w-full items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          or
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {!revealed ? (
        <>
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="w-full rounded-full border border-line bg-paper-elev px-5 py-2.5 text-center font-sans text-[14px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-paper-elev-2"
            aria-describedby="clerk-fallback-help"
            title="Use email or Google to sign in to a Liquid Clips account."
          >
            Sign in with email
          </button>
          <p
            id="clerk-fallback-help"
            className="text-center font-sans text-[11px] leading-[1.5] text-text-tertiary"
          >
            For direct accounts and legacy users who don&apos;t have a Whop login.
          </p>
        </>
      ) : (
        <div className="w-full">
          <SignIn
            routing="hash"
            signUpUrl={`/sign-up?redirect_url=${encodeURIComponent(backUrl)}`}
            forceRedirectUrl={backUrl}
            signUpForceRedirectUrl={backUrl}
          />
        </div>
      )}
    </div>
  );
}
