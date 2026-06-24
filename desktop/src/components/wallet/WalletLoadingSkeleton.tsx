/**
 * WalletLoadingSkeleton · brand-aligned shimmer while /me/wallet/summary
 * is in-flight. Matches the final panel's shape so the layout doesn't
 * shift when the data lands.
 *
 * Per the bespoke-craft skill: brand-tinted shimmer (fuchsia mid-stop),
 * not a generic spinner.
 */

export function WalletLoadingSkeleton() {
  return (
    <div className="lc-wallet" data-testid="wallet-loading">
      {/* Hero placeholder */}
      <div className="lc-wallet-sk-shimmer lc-wallet-sk-hero" aria-hidden="true" />

      {/* 4 stat cards */}
      <div className="lc-wallet-stats" aria-hidden="true">
        <div className="lc-wallet-sk-shimmer lc-wallet-sk-stat" />
        <div className="lc-wallet-sk-shimmer lc-wallet-sk-stat" />
        <div className="lc-wallet-sk-shimmer lc-wallet-sk-stat" />
        <div className="lc-wallet-sk-shimmer lc-wallet-sk-stat" />
      </div>

      {/* Section head + 3 table rows */}
      <div className="lc-wallet-section">
        <div className="lc-wallet-sk-shimmer lc-wallet-sk-section-h" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-row" />
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-row" />
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-row" />
        </div>
      </div>

      {/* Section head + 4 feed rows */}
      <div className="lc-wallet-section">
        <div className="lc-wallet-sk-shimmer lc-wallet-sk-section-h" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-feed-row" />
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-feed-row" />
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-feed-row" />
          <div className="lc-wallet-sk-shimmer lc-wallet-sk-feed-row" />
        </div>
      </div>
    </div>
  );
}
