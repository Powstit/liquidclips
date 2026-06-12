// v0.7.55 — Whop attribution badge.
//
// Per Daniel's locked architecture: every Whop-powered touchpoint shows
// a small "Powered by Whop" label so users understand Whop runs
// checkout, bounties, community chat, and submission handoff. Liquid
// Clips owns missions, tier logic, banners, upgrades, and bonuses.
//
// Use this beside:
//   • Whop checkout embed
//   • Whop bounty cards (submit / status)
//   • Whop community chat row
//   • Whop OAuth sign-in / connect
//   • Affiliate / referral checkout
//   • Admin Whop mapping panel
//
// Don't use on:
//   • Generic LC editor controls
//   • Non-Whop exports
//   • Pure LC surfaces
//
// Style is intentionally subtle — small, lowercase, mono, no big
// banner. Reads as a footnote, not an ad.

export function PoweredByWhop({
  size = "sm",
  className = "",
}: {
  size?: "xs" | "sm";
  className?: string;
}) {
  const textSize = size === "xs" ? "text-[9px]" : "text-[10px]";
  const iconSize = size === "xs" ? 10 : 12;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono ${textSize} uppercase tracking-[0.14em] text-text-tertiary ${className}`}
      aria-label="Powered by Whop"
    >
      powered by
      <WhopMark size={iconSize} />
      whop
    </span>
  );
}

// Whop wordmark approximation. The brand is widely public and the same
// glyph appears in every Whop SDK widget; rendering it inline avoids a
// network fetch and keeps the badge crisp at every size. Filled with
// `currentColor` so it inherits the text-tertiary token from the parent.
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
