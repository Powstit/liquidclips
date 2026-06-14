// v0.7.55 — Whop attribution badge (desktop copy).
//
// Same badge as account-app/src/components/embed/PoweredByWhop.tsx —
// duplicated because there's no shared module between desktop and the
// account-app. Both files MUST stay in sync visually (same dimensions,
// same wordmark glyph, same fuchsia token, same tracking).
//
// Use this on:
//   • Whop bounty cards (submit / status)
//   • Whop community chat rows
//   • Whop OAuth sign-in / connect
//   • Affiliate / referral checkout entry
//
// Don't use on:
//   • Generic LC editor controls
//   • Non-Whop exports
//   • Pure LC surfaces

import { openSmart } from "../lib/openSmart";

export function PoweredByWhop({
  size = "sm",
  className = "",
  onClick = () => openSmart("https://whop.com/liquidclips/"),
}: {
  size?: "xs" | "sm";
  className?: string;
  /** Option A — clickable attribution. Omit to render non-interactive. */
  onClick?: (() => void) | null;
}) {
  const textSize = size === "xs" ? "text-[9px]" : "text-[10px]";
  const iconSize = size === "xs" ? 10 : 12;
  const body = (
    <>
      powered by
      <WhopMark size={iconSize} />
      whop
    </>
  );
  if (!onClick) {
    // Powered-by attribution, intentionally non-interactive.
    return (
      <span
        className={`inline-flex items-center gap-1 font-mono ${textSize} uppercase tracking-[0.14em] text-text-tertiary ${className}`}
        aria-label="Powered by Whop"
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1 font-mono ${textSize} uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-ink ${className}`}
      aria-label="Powered by Whop"
    >
      {body}
    </button>
  );
}

function WhopMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="text-fuchsia"
    >
      <path d="M3 6h3.6l1.8 8.4L10.5 6h3l2.1 8.4L17.4 6H21l-3.6 12h-3.3l-2.1-7.8L9.9 18H6.6L3 6z" />
    </svg>
  );
}
