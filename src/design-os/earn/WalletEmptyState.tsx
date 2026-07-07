/**
 * WalletEmptyState · zero-submissions celebration → "go earn"
 *
 * Uses the brand-shipped chest-reward.webp asset (created via gpt-image-1
 * per the bespoke-craft skill — no Lucide / stock icons). Routes the
 * clipper to the campaigns surface so the next step is one click away.
 */

export interface WalletEmptyStateProps {
  /** Click handler · should route to the campaigns list (defaults to a
   *  no-op so the component is droppable in storybook / preview). */
  onBrowseCampaigns?: () => void;
}

export function WalletEmptyState({ onBrowseCampaigns }: WalletEmptyStateProps) {
  return (
    <div className="lc-wallet-empty" data-testid="wallet-empty-state">
      <img
        className="lc-wallet-empty-art"
        src="/brand/reward/chest-reward.webp"
        alt=""
        aria-hidden="true"
      />
      <div>
        <h3 className="lc-wallet-empty-title">Your wallet is waiting</h3>
        <p className="lc-wallet-empty-sub">
          Submit your first clip to a sponsored campaign and you'll see your
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
