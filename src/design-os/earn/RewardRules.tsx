/**
 * RewardRules · generic rules section shown inside ANY clipping reward.
 *
 * Mandatory per Daniel's 2026-06-23 directive: every clipping reward (Whop,
 * sponsored, agency-owned) must surface its rules so the user knows what
 * qualifies and what doesn't BEFORE they grind for the payout.
 *
 * Honest copy rules (Daniel-locked):
 *   - Pending money is NOT withdrawable. Don't say it is.
 *   - Subscription is NOT paid from the bonus. Don't imply it is.
 *   - Payout is NOT promised before clearance. Don't suggest otherwise.
 *   - Authenticated platform views only · bots / view-farms don't count.
 *   - Duplicate clips don't double-count.
 *
 * // SOVEREIGN-2.2 · once backend lands, the rules text is fetched from
 * each campaign's `rules` field on the server instead of being hard-coded
 * per campaign. This component stays as the rendering shell.
 */

import { Watchdog } from "../../lib/watchdog/Watchdog";
import "./RewardRules.css";

export interface RewardRule {
  /** Plain-text rule line · max 1 short sentence. */
  text: string;
  /** Optional tone · "info" (default) or "warn" (highlighted muted). */
  tone?: "info" | "warn";
}

export interface RewardRulesProps {
  /** Section heading · defaults to "Rules". */
  title?: string;
  /** Bulleted rule list. */
  rules: RewardRule[];
  /** Optional footer note (e.g., simulator label). */
  footer?: string;
  /** Optional test id override · defaults to "reward-rules". */
  testId?: string;
}

export function RewardRules({
  title = "Rules",
  rules,
  footer,
  testId = "reward-rules",
}: RewardRulesProps) {
  return (
    <Watchdog
      id="money/mo-13/reward-rules"
      label="Reward rules (mo-13 · Sui payout copy promise)"
      cluster="money"
      source="src/design-os/earn/RewardRules.tsx:40"
    >
      <section className="lc-reward-rules" data-testid={testId}>
        <h4 className="lc-reward-rules-h">{title}</h4>
        <ul className="lc-reward-rules-list">
          {rules.map((r, i) => (
            <li
              key={i}
              className={`lc-reward-rules-item is-${r.tone ?? "info"}`}
              data-tone={r.tone ?? "info"}
            >
              <span className="lc-reward-rules-dot" aria-hidden="true" />
              <span className="lc-reward-rules-text">{r.text}</span>
            </li>
          ))}
        </ul>
        {footer && (
          <p className="lc-reward-rules-footer" data-testid={`${testId}-footer`}>
            {footer}
          </p>
        )}
      </section>
    </Watchdog>
  );
}

/**
 * Canonical rule set for the $50 Sponsored Reward · matches Sponsored
 * Master PRD Section I.2 + Section III + Section IV verbatim. Updated
 * 2026-06-23 with Daniel's locked rules.
 */
export const SPONSORED_REWARD_RULES: RewardRule[] = [
  { text: "$50 USD payout per 5,000 authenticated tracked views (recurring · counter resets after each payout)." },
  { text: "OR $50 USD per 5 paying-sub referrals (alternative qualification path)." },
  { text: "Active paid subscription required to TRACK views OR claim payout." },
  { text: "Cancelling pauses tracking · views freeze at current count and resume on re-subscribe.", tone: "warn" },
  { text: "7-day clearance hold begins when both milestone + active subscription are met." },
  { text: "5% Liquid Clips protocol fee applies to every withdrawal once the payout rail is live." },
  { text: "Payouts unlock when the withdrawal rail goes live · we'll DM you the moment it's open.", tone: "warn" },
  { text: "Authenticated platform views only · matched to your posted clip URLs · bot traffic and view-farms don't count.", tone: "warn" },
  { text: "Duplicate clip URLs counted once · same video can't claim twice." },
  { text: "Engagement audit during clearance: ≥3% likes-to-views, ≥0.5% comments-to-views.", tone: "warn" },
];
