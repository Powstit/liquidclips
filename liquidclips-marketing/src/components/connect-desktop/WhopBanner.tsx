"use client";

/**
 * Inline banner above the sign-in cards. Renders a specific message based
 * on the `whop_*` URL params that junior-backend's
 * /auth/whop/callback adds when the OAuth round-trip can't complete cleanly.
 *
 * State vocabulary matches the backend exactly — see
 * `junior-backend/app/routes/auth_whop.py` for the canonical 302 targets.
 */

import type { WhopUrlState } from "@/lib/whop-oauth";

type Props = {
  state: WhopUrlState;
  /** Optional CTA URL for the "no membership" state — typically a Whop
   *  affiliate / product URL. Hidden if empty. */
  affiliateUrl?: string;
};

export function WhopBanner({ state, affiliateUrl }: Props) {
  if (state === "none") return null;

  if (state === "nomembership") {
    return (
      <div
        className="flex w-full max-w-[440px] flex-col items-center gap-3 rounded-2xl border border-line bg-paper-elev px-5 py-4 text-center"
        role="status"
      >
        <p className="font-sans text-[14px] font-medium text-ink">
          No Liquid Clips membership found on that Whop account.
        </p>
        <p className="font-sans text-[12px] text-text-secondary">
          Pick one up below, or sign in with email to use an existing
          direct account.
        </p>
        {affiliateUrl && (
          <a
            href={affiliateUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-paper transition-colors hover:bg-fuchsia-bright"
          >
            Get a membership →
          </a>
        )}
      </div>
    );
  }

  // cancelled / disabled / error — single compact strip; the user can retry
  // Whop or fall through to the Clerk widget below.
  const msg: Record<Exclude<WhopUrlState, "none" | "nomembership">, string> = {
    cancelled:
      "Whop sign-in was cancelled. Try again or use email below.",
    disabled:
      "Whop sign-in is temporarily unavailable. Use email below.",
    error: "Whop sign-in hit an error. Try again or use email below.",
  };
  return (
    <div
      className="w-full max-w-[440px] rounded-2xl border border-line bg-paper-elev px-4 py-3 text-center font-sans text-[12px] text-text-secondary"
      role="status"
    >
      {msg[state]}
    </div>
  );
}
