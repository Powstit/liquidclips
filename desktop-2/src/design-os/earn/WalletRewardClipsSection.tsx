/**
 * WalletRewardClipsSection · D1-cluster-Z (2026-07-12)
 *
 * Minimal reward-clip summary rail mounted below WalletDetail on the
 * earn surface. WalletDetail owns the balance/ledger view — this
 * component surfaces the actual `RewardClip` rows that Publish's mint
 * step (POST /me/reward-clips) writes so the customer sees "your clip
 * just posted → row appears in the wallet" without navigating away.
 *
 * Data comes from the same `useRewardClips()` hook the legacy
 * EarnRoute uses so real-http intercepts (Playwright + real backend)
 * light this section up in lockstep with the deprecated Earn surface.
 *
 * Renders honest empty states:
 *   loading   → skeleton row
 *   error     → single hint line, no fake data
 *   empty     → "No submissions yet." copy
 *   loaded    → titles rendered in a compact list (no drawer/click
 *               handlers — the wallet rail is for status, not editing;
 *               editing lives in the legacy Earn route until the
 *               ledger absorbs it).
 */

import { useRewardClips } from "../state/useRewardClips";

export function WalletRewardClipsSection(): JSX.Element {
  const rc = useRewardClips();

  if (rc.loading) {
    return (
      <section
        className="wd-reward-clips wd-reward-clips-loading"
        aria-label="Reward clips"
        data-testid="wallet-reward-clips-loading"
      >
        <span className="wd-reward-clips-eb">Reward clips</span>
        <p className="wd-reward-clips-hint">Loading your recent submissions…</p>
      </section>
    );
  }

  if (rc.error) {
    return (
      <section
        className="wd-reward-clips wd-reward-clips-offline"
        aria-label="Reward clips"
        data-testid="wallet-reward-clips-offline"
      >
        <span className="wd-reward-clips-eb">Reward clips</span>
        <p className="wd-reward-clips-hint" role="alert" aria-live="polite">
          Reward clips are briefly out of reach. Retry from the earn tab.
        </p>
      </section>
    );
  }

  if (rc.clips.length === 0) {
    return (
      <section
        className="wd-reward-clips wd-reward-clips-empty"
        aria-label="Reward clips"
        data-testid="wallet-reward-clips-empty"
      >
        <span className="wd-reward-clips-eb">Reward clips</span>
        <p className="wd-reward-clips-hint">
          No submissions yet. Publish a clip to a campaign to see it land here.
        </p>
      </section>
    );
  }

  return (
    <section
      className="wd-reward-clips"
      aria-label="Reward clips"
      data-testid="wallet-reward-clips"
    >
      <span className="wd-reward-clips-eb">Reward clips</span>
      <ul className="wd-reward-clips-list">
        {rc.clips.map((c) => (
          <li
            key={c.id}
            className="wd-reward-clips-row"
            data-testid="wallet-reward-clips-row"
            data-clip-id={c.id}
            data-status={c.status ?? ""}
          >
            <span className="wd-reward-clips-title">
              {/* whopRewardTitle is populated by the sidecar-stub
               *  adapter (BackendRewardClipBlock.whop_reward_title →
               *  camelCase). Fall back to a short slug when the
               *  backend leaves the title null so an anonymous mint
               *  still renders a locator-friendly stub. */}
              {c.whopRewardTitle ?? `Reward clip · ${c.id.slice(0, 8)}`}
            </span>
            {c.status ? (
              <span className="wd-reward-clips-status" data-status={c.status}>
                {c.status}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
