/**
 * WalletEmptyState · zero-submissions celebration → "go earn"
 *
 * Routes the clipper to the campaigns surface so the next step is one
 * click away.
 *
 * desktop/ adaptation note: the desktop-2 build references
 * `/brand/reward/chest-reward.webp` (gpt-image-1 asset). That asset is
 * not yet shipped to desktop/public/, so we render a custom inline SVG
 * mark — fuchsia coin stack glyph — using only brand tokens. Inline SVG
 * here is bespoke-craft compliant (no Lucide, no stock CDN, no
 * placeholder library). When the .webp asset is added to
 * desktop/public/brand/reward/ in a later sprint, swap the SVG for
 * `<img src="/brand/reward/chest-reward.webp" />`.
 */

export interface WalletEmptyStateProps {
  /** Click handler · should route to the campaigns list (defaults to a
   *  no-op so the component is droppable in storybook / preview). */
  onBrowseCampaigns?: () => void;
}

export function WalletEmptyState({ onBrowseCampaigns }: WalletEmptyStateProps) {
  return (
    <div className="lc-wallet-empty" data-testid="wallet-empty-state">
      <WalletEmptyArt />
      <div>
        <h3 className="lc-wallet-empty-title">Your wallet is waiting</h3>
        <p className="lc-wallet-empty-sub">
          Submit your first clip to a sponsored campaign and you&rsquo;ll see your
          earnings move through review, approval, and payout — right here.
        </p>
      </div>
      <button
        type="button"
        className="lc-wallet-empty-cta"
        data-testid="wallet-empty-cta"
        onClick={onBrowseCampaigns}
      >
        Browse campaigns →
      </button>
    </div>
  );
}

/**
 * Bespoke inline SVG · fuchsia coin stack. All strokes/fills resolve to
 * brand tokens so the mark stays in sync with any brand tuning. No
 * external asset, no Lucide.
 */
function WalletEmptyArt() {
  return (
    <svg
      className="lc-wallet-empty-art"
      width="96"
      height="96"
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lcWalletCoinGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff1a8c" />
          <stop offset="55%" stopColor="#c70066" />
          <stop offset="100%" stopColor="#ff66b8" />
        </linearGradient>
        <radialGradient id="lcWalletCoinGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ff1a8c" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ff1a8c" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* halo */}
      <circle cx="48" cy="48" r="44" fill="url(#lcWalletCoinGlow)" />
      {/* bottom coin */}
      <ellipse cx="48" cy="68" rx="28" ry="8" fill="url(#lcWalletCoinGrad)" opacity="0.85" />
      <ellipse cx="48" cy="65" rx="28" ry="8" fill="#0b0b10" />
      <ellipse cx="48" cy="65" rx="28" ry="8" stroke="#ff66b8" strokeWidth="1.5" fill="none" />
      {/* middle coin */}
      <ellipse cx="48" cy="52" rx="28" ry="8" fill="url(#lcWalletCoinGrad)" opacity="0.95" />
      <ellipse cx="48" cy="49" rx="28" ry="8" fill="#0b0b10" />
      <ellipse cx="48" cy="49" rx="28" ry="8" stroke="#ff66b8" strokeWidth="1.5" fill="none" />
      {/* top coin */}
      <ellipse cx="48" cy="36" rx="28" ry="8" fill="url(#lcWalletCoinGrad)" />
      <ellipse cx="48" cy="33" rx="28" ry="8" fill="#0b0b10" />
      <ellipse cx="48" cy="33" rx="28" ry="8" stroke="#ff1a8c" strokeWidth="1.75" fill="none" />
      {/* dollar mark on top coin */}
      <text
        x="48"
        y="38.5"
        fill="#ff66b8"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="800"
        fontSize="13"
        textAnchor="middle"
      >
        $
      </text>
    </svg>
  );
}
