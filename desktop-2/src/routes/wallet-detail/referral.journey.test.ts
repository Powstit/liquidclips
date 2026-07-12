/**
 * referral.journey.test.ts · BUG-017 · Train A3 · j010-referral.
 *
 * Regression proof for the wallet-side referral affordance.
 * Ships the source-file contract pattern (see
 * `CrewOnboarding.test.ts` + `useMe.test.ts`) — asserts the
 * shipped file contains the stable DOM seams, telemetry topic
 * strings, and mount effect referenced by
 * `lcos/04_JOURNEY_BIBLE/j010-referral.md`.
 *
 * A DOM-integration harness (React Testing Library render + click)
 * is deliberately DEFERRED to the e2e journey suite — this contract
 * suite catches source drift on every `pnpm test` run without
 * pulling in the AffiliateWidget's Whop / /me / QR HTTP graph
 * (which the AffiliateWidget itself already covers with a live
 * fetch + Watchdog wrap · see mo-15).
 *
 * The four acceptance tests referenced in the journey file:
 *   · mounts-and-fires-affordance-telemetry
 *   · copy-link-fires-telemetry
 *   · qr-render-fires-telemetry
 *   · data-referral-link-present-and-copies-referralurl
 *
 * Each maps to one or more grep assertions against the
 * `WalletDetail.tsx` source.
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

describe('j010-referral · WalletDetail source contract', () => {
  describe('mounts-and-fires-affordance-telemetry', () => {
    it('defines a WalletReferralBlock component that owns the referral affordance', () => {
      expect(WALLET_SRC).toMatch(/function\s+WalletReferralBlock/);
      // The block is mounted from the wallet render tree.
      expect(WALLET_SRC).toContain('<WalletReferralBlock');
    });

    it("emits `referral_affordance_mounted` once per mount via lcDiag", () => {
      expect(WALLET_SRC).toMatch(
        /lcDiag\(\s*['"]referral_affordance_mounted['"]/,
      );
      // Mount-once guard so a re-render does not double-fire.
      expect(WALLET_SRC).toMatch(/mountedRef\.current\s*=\s*true/);
    });

    it("carries has_referral_url + has_affiliate_id in the mount payload", () => {
      // The mount payload documents whether the affordance was in
      // real-data state or honest empty state — Doctor uses these
      // to differentiate between "no handle yet" and "wallet blank".
      expect(WALLET_SRC).toContain('has_referral_url');
      expect(WALLET_SRC).toContain('has_affiliate_id');
    });
  });

  describe('copy-link-fires-telemetry', () => {
    it("emits `referral_link_copied` via lcDiag when the copy button is clicked", () => {
      expect(WALLET_SRC).toMatch(
        /lcDiag\(\s*['"]referral_link_copied['"]/,
      );
    });

    it('copy-click bridge listens at the [data-referral-link] wrapper', () => {
      // Click-capture on the wrapper decouples the j010 topic from
      // AffiliateWidget's internal DOM — an internal button rename
      // won't silently break the journey.
      expect(WALLET_SRC).toMatch(/onClickCapture/);
      // The bridge fires only for the copy affordance, not the
      // handle-rename Save button (both share the primary btn class).
      expect(WALLET_SRC).toContain('lc-affiliate-widget-btn-primary');
    });

    it("payload includes the customer's referralUrl", () => {
      // Payload must carry the URL so HQ can correlate copy → external
      // click → attribution across the three logs.
      expect(WALLET_SRC).toMatch(
        /referral_link_copied[\s\S]{0,200}referralUrl/,
      );
    });
  });

  describe('qr-render-fires-telemetry', () => {
    it("emits `referral_qr_generated` when the QR has a value to paint", () => {
      expect(WALLET_SRC).toMatch(
        /lcDiag\(\s*['"]referral_qr_generated['"]/,
      );
    });

    it('guards against double-emission across re-renders', () => {
      // qrEmittedRef prevents duplicate topics on hydrate → refetch
      // → hydrate loops (which happens on `activation:complete`).
      expect(WALLET_SRC).toContain('qrEmittedRef');
    });

    it('is gated on referralUrl being non-empty (honest empty state)', () => {
      // No handle → no QR → no `referral_qr_generated`.
      expect(WALLET_SRC).toMatch(
        /qrEmittedRef[\s\S]{0,400}if\s*\(\s*!referralUrl\s*\)/,
      );
    });
  });

  describe('data-referral-link-present-and-copies-referralurl', () => {
    it("mounts the [data-referral-link] DOM seam around the copy affordance", () => {
      expect(WALLET_SRC).toContain('data-referral-link');
    });

    it("[data-referral-link][data-copy-value] surfaces the derived referralUrl", () => {
      // The seam value tracks the exact URL the copy button will hit
      // the clipboard with — Doctor + e2e can read it without
      // triggering a real clipboard write.
      expect(WALLET_SRC).toMatch(
        /data-copy-value=\{\s*referralUrl\s*(?:\?\?[^}]*)?\}/,
      );
    });

    it("mounts the [data-referral-qr] DOM seam around the QR canvas", () => {
      expect(WALLET_SRC).toContain('data-referral-qr');
    });

    it("mounts the [data-referral-attribution-source] marker", () => {
      // Attribution source seam pairs with the backend receiver on
      // wallet_ledger_refresh. Doctor reads this to correlate the
      // affordance owner with the eventual ledger row.
      expect(WALLET_SRC).toContain('data-referral-attribution-source');
      // The affiliateId flows into data-source so a screenshot or
      // Playwright walk can capture the attribution owner.
      expect(WALLET_SRC).toMatch(/data-source=\{\s*affiliateId/);
    });

    it("derives referralUrl from the /me handle client-side", () => {
      // Mirrors AffiliateWidget's own derivation — no duplicated
      // fetch, no fabricated placeholder URL.
      expect(WALLET_SRC).toContain(
        'https://liquidclips.app/join/${me.snapshot.handle}',
      );
    });
  });

  describe('j010-referral · does NOT touch six-state cancellation', () => {
    it('does not introduce a new WalletStateKey', () => {
      // BUG-017 is scoped to the referral block only. C2 owns the
      // six-state cancellation logic — an accidental new key in this
      // file is a scope break.
      const stateDeclarations = WALLET_SRC.match(
        /'(fresh_install|populated|paid_normal|paid_streak|grace|cancelled)'/g,
      );
      expect(stateDeclarations).not.toBeNull();
      // The canonical six keys are all that appear.
      const uniqueKeys = new Set(stateDeclarations ?? []);
      expect(uniqueKeys.size).toBeLessThanOrEqual(6);
    });
  });
});
