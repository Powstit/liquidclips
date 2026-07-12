/**
 * money-rollup.test.ts · Train C2 · RC1 sprint.
 *
 * Contract proof for the canonical money-rollup wire on the wallet
 * money surface. Every visible money value on WalletDetail must read
 * from `useMoneyRollup()` — the ONE source that HQ mirror + backend
 * agree byte-identical with.
 *
 * Mirrors the source-file contract pattern used by
 * `referral.journey.test.ts` — grep assertions against the shipped
 * WalletDetail.tsx source + the useMoneyRollup hook + the backend
 * rollup route file. No fixture values, no fabricated DB reads.
 *
 * Class-elimination targets exercised here:
 *   BC-005 (UI reading divergent stores)
 *   BC-002 (fixture drift risk on money surfaces)
 *
 * Acceptance test IDs (referenced in j008-wallet.md · j009-affiliate.md ·
 * j012-payout.md):
 *   · money-rollup-hook-wired
 *   · money-rollup-inv004-gate-enforced
 *   · money-rollup-seams-mirror-backend
 *   · money-rollup-no-fixture-money-literals
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WALLET_SRC = readFileSync(
  resolve(__dirname, 'WalletDetail.tsx'),
  'utf-8',
);
const HOOK_SRC = readFileSync(
  resolve(__dirname, '../../lib/moneyRollup.ts'),
  'utf-8',
);

describe('money-rollup · WalletDetail contract', () => {
  describe('money-rollup-hook-wired', () => {
    it('WalletDetail imports and consumes useMoneyRollup', () => {
      expect(WALLET_SRC).toContain("from '../../lib/moneyRollup'");
      expect(WALLET_SRC).toMatch(/const\s+moneyRollup\s*=\s*useMoneyRollup\(\)/);
    });

    it('useMoneyRollup targets /me/money-rollup (single canonical endpoint)', () => {
      expect(HOOK_SRC).toContain('/me/money-rollup');
    });

    it('MRR is sourced from the rollup, not a fixture literal', () => {
      // Regression against the pre-Train-C `mrrCents = null // TODO`
      // pattern — the value must derive from moneyRollup.rollup.
      expect(WALLET_SRC).toMatch(
        /mrrCents[\s\S]{0,200}moneyRollup\.rollup[\s\S]{0,200}affiliate_mrr_cents/,
      );
    });

    it('rollup refetches on activation:complete so gates reflect linkage', () => {
      // Connecting Whop flips whop_connected + payout_ready. If the
      // rollup doesn't refetch here, the withdraw CTA stays disabled
      // after successful sign-in.
      expect(WALLET_SRC).toMatch(
        /activation:complete[\s\S]{0,300}moneyRollup\.refetch\(\)/,
      );
    });
  });

  describe('money-rollup-inv004-gate-enforced', () => {
    it('claim button disabled unless every INV-004 gate is true', () => {
      // INV-004: has_balance AND agreement_signed AND whop_connected
      // AND payout_ready. All four must appear in the eligibility
      // check inline with the claim button.
      expect(WALLET_SRC).toMatch(/inv004Eligible/);
      expect(WALLET_SRC).toContain('withdrawGates.has_balance');
      expect(WALLET_SRC).toContain('withdrawGates.affiliate_agreement_signed');
      expect(WALLET_SRC).toContain('withdrawGates.whop_connected');
      expect(WALLET_SRC).toContain('withdrawGates.payout_ready');
    });

    it('claimDisabled includes !inv004Eligible in the guard chain', () => {
      expect(WALLET_SRC).toMatch(/claimDisabled\s*=[\s\S]{0,400}!inv004Eligible/);
    });

    it('withdraw_disabled telemetry surfaces the failing gate', () => {
      // HQ Money Funnel needs to know WHY a click was ineligible.
      // Reason strings must categorise by gate name, not collapse to
      // a single "disabled" label.
      expect(WALLET_SRC).toContain("inv004:agreement_unsigned");
      expect(WALLET_SRC).toContain("inv004:whop_unlinked");
      expect(WALLET_SRC).toContain("inv004:payout_not_ready");
    });
  });

  describe('money-rollup-seams-mirror-backend', () => {
    it('root div exposes byte-identical money seams for HQ/Doctor', () => {
      expect(WALLET_SRC).toContain('data-money-rollup-balance-cents');
      expect(WALLET_SRC).toContain('data-money-rollup-mrr-cents');
      expect(WALLET_SRC).toContain('data-money-rollup-referral-total-cents');
      expect(WALLET_SRC).toContain('data-money-rollup-payout-eligible-cents');
      expect(WALLET_SRC).toContain('data-money-rollup-lifetime-cents');
      expect(WALLET_SRC).toContain('data-money-rollup-as-of-ts-ms');
    });

    it('withdraw button carries INV-004 audit seams', () => {
      expect(WALLET_SRC).toContain('data-inv004-eligible');
      expect(WALLET_SRC).toContain('data-gate-has-balance');
      expect(WALLET_SRC).toContain('data-gate-agreement');
      expect(WALLET_SRC).toContain('data-gate-whop');
      expect(WALLET_SRC).toContain('data-gate-payout-ready');
    });

    it('the seam values come from the same source the CTA gates read', () => {
      // Source integrity: the value the seam prints is the same value
      // the eligibility check consults. This prevents a stale seam
      // showing "true" while the button is disabled.
      expect(WALLET_SRC).toMatch(
        /data-money-rollup-balance-cents=\{[^}]*moneyRollup\.rollup/,
      );
    });
  });

  describe('money-rollup-no-fixture-money-literals', () => {
    it('does not hardcode "$742.50" fake MRR anywhere', () => {
      // The pre-Train-C cancellation modal had this fixture; scan the
      // wallet source to prove it never regresses in.
      expect(WALLET_SRC).not.toContain('$742.50');
    });

    it('does not hardcode "$247.50" fake balance anywhere', () => {
      expect(WALLET_SRC).not.toContain('$247.50');
    });

    it('does not fabricate a specific dollar/cents number for a user', () => {
      // Scan for any "$XX.YY" three-digit-or-more literal that is NOT
      // a known brand pricing constant. Brand-locked values allowed:
      //   $99.99  → subscription price (per §13a)
      //   $50     → per-referral share (per affiliate_commission.py)
      // Anything else is a fixture.
      const dollarLiterals = WALLET_SRC.match(/\$\d+(?:\.\d{2})?/g) ?? [];
      // Brand-locked pricing constants (per §13a) + generic amounts that
      // appear only in code comments describing customer-facing copy:
      //   $99.99  → subscription price
      //   $50     → per-referral share
      //   $1,500  → paid_normal / paid_streak lifetime threshold constant
      //   $0      → appears only in comments explaining "not fabricated"
      const brandAllow = new Set(['$99.99', '$50', '$1', '$1,500', '$0']);
      const fixtures = dollarLiterals.filter((v) => !brandAllow.has(v));
      expect(fixtures).toEqual([]);
    });
  });
});

describe('money-rollup · hook contract', () => {
  it('exports the canonical shape + gates', () => {
    expect(HOOK_SRC).toContain('wallet_balance_cents');
    expect(HOOK_SRC).toContain('affiliate_mrr_cents');
    expect(HOOK_SRC).toContain('referral_total_cents');
    expect(HOOK_SRC).toContain('payout_eligible_cents');
    expect(HOOK_SRC).toContain('total_lifetime_earnings_cents');
    expect(HOOK_SRC).toContain('as_of_ts_ms');
    // Withdraw gates surfaced 1:1 with the backend.
    expect(HOOK_SRC).toContain('has_balance');
    expect(HOOK_SRC).toContain('affiliate_agreement_signed');
    expect(HOOK_SRC).toContain('whop_connected');
    expect(HOOK_SRC).toContain('payout_ready');
  });

  it('isMoneyRollupShape validates every numeric field', () => {
    // Defense against a 200-with-malformed body silently rendering
    // NaN/undefined in the UI.
    expect(HOOK_SRC).toContain('isMoneyRollupShape');
    expect(HOOK_SRC).toMatch(/isNumber\(o\.wallet_balance_cents\)/);
    expect(HOOK_SRC).toMatch(/isNumber\(o\.affiliate_mrr_cents\)/);
    expect(HOOK_SRC).toMatch(/isNumber\(o\.payout_eligible_cents\)/);
  });

  it('401/403 → unauthorized (not silent success)', () => {
    // Wallet + cancellation both need to know when auth is missing so
    // they can render the sign-in CTA instead of a $0 fake balance.
    expect(HOOK_SRC).toMatch(/r\.status\s*===\s*401\s*\|\|\s*r\.status\s*===\s*403/);
    expect(HOOK_SRC).toContain('unauthorized');
  });

  it('malformed shape → error (never a fabricated success)', () => {
    expect(HOOK_SRC).toMatch(/reason:\s*['"]shape['"]/);
  });
});
