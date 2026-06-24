"use client";

/**
 * Primary CTA on /connect-desktop. Renders the "Sign in with Whop" door at
 * the top of the fold per memory `liquid-clips-whop-lead-decision` —
 * Whop owns identity, Clerk is the fallback.
 *
 * Visual contract (brand-kit; no Lucide defaults):
 *   - Fuchsia brand button (--fuchsia) with the cyan secondary signal as
 *     the inline mark — uses the same colour tokens as the rest of the
 *     marketing site (see globals.css).
 *   - Tooltip / helper text explains WHO this is for ("if you bought via
 *     Whop or a creator link, this is the fastest path").
 *   - Disabled state (no challenge / flag off) renders as a quiet ghost
 *     button so the layout never collapses.
 *
 * The mark itself is a typographic glyph ("W·") rather than a third-party
 * SVG — per bespoke-craft memory we don't ship trademarked logos we
 * haven't been licensed to use. A future asset drop can swap the glyph
 * for the official Whop wordmark once Whop confirms brand-use clearance.
 */

import { useMemo } from "react";

type Props = {
  /** Same-origin start URL (built by /api/whop-oauth/start). Pass empty
   *  string to render the disabled state. */
  href: string;
  /** Show the helper subtitle below the button. Default true. */
  showHelper?: boolean;
  /** Tooltip / aria-description copy. Defaults to the canonical "for Whop
   *  members" line. */
  description?: string;
};

const DEFAULT_DESCRIPTION =
  "Fastest if you bought Liquid Clips via Whop or a creator's affiliate link.";

export function WhopSignInButton({
  href,
  showHelper = true,
  description = DEFAULT_DESCRIPTION,
}: Props) {
  const disabled = !href;
  const role = useMemo(
    () => (disabled ? { "aria-disabled": true as const } : {}),
    [disabled],
  );

  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-3">
      <a
        href={disabled ? "#" : href}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
        className={[
          "group inline-flex w-full items-center justify-center gap-3",
          "rounded-full px-6 py-3.5",
          "font-sans text-[15px] font-semibold tracking-[-0.005em]",
          "transition-all duration-200",
          disabled
            ? "cursor-not-allowed border border-line bg-paper-elev text-text-tertiary opacity-60"
            : "bg-fuchsia text-paper shadow-[0_8px_32px_-8px_rgba(255,26,140,0.6)] hover:bg-fuchsia-bright hover:shadow-[0_12px_40px_-8px_rgba(255,26,140,0.7)] active:translate-y-[1px]",
        ].join(" ")}
        title={description}
        aria-describedby="whop-signin-help"
        {...role}
      >
        <span
          aria-hidden
          className={[
            "inline-grid h-6 w-6 place-items-center rounded-md font-mono text-[13px] font-bold leading-none",
            disabled
              ? "bg-line text-text-tertiary"
              : "bg-paper text-fuchsia group-hover:bg-paper-warm",
          ].join(" ")}
        >
          W
        </span>
        <span>Sign in with Whop</span>
        <span
          aria-hidden
          className={[
            "ml-1 inline-block transition-transform duration-200",
            disabled ? "" : "group-hover:translate-x-0.5",
          ].join(" ")}
        >
          →
        </span>
      </a>
      {showHelper && (
        <p
          id="whop-signin-help"
          className="text-center font-sans text-[12px] leading-[1.5] text-text-secondary"
        >
          {description}
        </p>
      )}
    </div>
  );
}
