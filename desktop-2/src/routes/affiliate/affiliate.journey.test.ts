/**
 * affiliate.journey.test.ts · Train C2 · RC1 sprint.
 *
 * Contract proof for the affiliate revenue surface. The Liquid Clips
 * affiliate dashboard is composed from three source files:
 *
 *   1. `desktop-2/src/design-os/earn/AffiliateWidget.tsx`
 *      — copy-URL + QR + handle-rename business logic.
 *   2. `desktop-2/src/routes/wallet-detail/WalletDetail.tsx`
 *      — mounts AffiliateWidget on the wallet money surface + owns
 *        the affiliate MRR metric row (via useMoneyRollup).
 *   3. `desktop-2/src/lib/moneyRollup.ts`
 *      — canonical hook, single source of affiliate MRR.
 *
 * This suite asserts the CROSS-file contract every affiliate journey
 * relies on — the referral URL derivation seams (owned by A3 · exercised
 * here for cross-surface parity), the affiliate MRR path (owned by C2),
 * and the payout-eligibility gates that unlock affiliate revenue.
 *
 * Acceptance test IDs (referenced in `lcos/04_JOURNEY_BIBLE/j009-affiliate.md`):
 *   · affiliate-mrr-reads-canonical-rollup
 *   · affiliate-payout-eligibility-gated
 *   · affiliate-widget-mounted-on-wallet
 *   · affiliate-attribution-endpoint-shape
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WALLET_SRC = readFileSync(
  resolve(__dirname, '../wallet-detail/WalletDetail.tsx'),
  'utf-8',
);
const HOOK_SRC = readFileSync(
  resolve(__dirname, '../../lib/moneyRollup.ts'),
  'utf-8',
);
const WIDGET_SRC = readFileSync(
  resolve(__dirname, '../../design-os/earn/AffiliateWidget.tsx'),
  'utf-8',
);
const BACKEND_ROLLUP_SRC = readFileSync(
  resolve(
    __dirname,
    '../../../../junior-backend/app/routes/money_rollup.py',
  ),
  'utf-8',
);
const BACKEND_AFFILIATE_SRC = readFileSync(
  resolve(
    __dirname,
    '../../../../junior-backend/app/routes/affiliate.py',
  ),
  'utf-8',
);

describe('j009-affiliate · MRR + payout contract', () => {
  describe('affiliate-mrr-reads-canonical-rollup', () => {
    it('backend computes MRR from eligible_referral_count × per-ref cents', () => {
      // Regression guard against a re-implementation that skips the
      // canonical eligibility service. Every MRR read must flow through
      // eligible_referral_count so 7-day good-standing + affiliate
      // qualification stay consistent with services/affiliate_commission.
      expect(BACKEND_ROLLUP_SRC).toContain('eligible_referral_count');
      expect(BACKEND_ROLLUP_SRC).toContain(
        'BASE_AFFILIATE_MRR_CENTS_PER_REFERRAL',
      );
      // Rate constant is imported under the local alias
      // `AFFILIATE_MRR_SHARE_PCT` from the affiliate_commission service.
      expect(BACKEND_ROLLUP_SRC).toMatch(
        /AFFILIATE_MRR_SHARE_PCT/,
      );
    });

    it('wallet UI reads affiliate_mrr_cents from the same rollup hook', () => {
      expect(WALLET_SRC).toMatch(
        /mrrCents[\s\S]{0,300}affiliate_mrr_cents/,
      );
      // Not a hardcoded fallback that could drift under empty data.
      expect(WALLET_SRC).not.toMatch(
        /mrrCents\s*=\s*\d+/,
      );
    });

    it('MRR field appears on the canonical rollup TypeScript shape', () => {
      expect(HOOK_SRC).toContain('affiliate_mrr_cents');
    });
  });

  describe('affiliate-payout-eligibility-gated', () => {
    it('backend surfaces four withdraw gates (INV-004)', () => {
      expect(BACKEND_ROLLUP_SRC).toContain('has_balance');
      expect(BACKEND_ROLLUP_SRC).toContain('affiliate_agreement_signed');
      expect(BACKEND_ROLLUP_SRC).toContain('whop_connected');
      expect(BACKEND_ROLLUP_SRC).toContain('payout_ready');
    });

    it('agreement check flows through get_active_signature service', () => {
      // The affiliate_agreement.get_active_signature service is the
      // canonical writer/checker. The rollup MUST NOT re-implement.
      expect(BACKEND_ROLLUP_SRC).toContain('get_active_signature');
    });

    it('is_admin_bypass short-circuits the agreement gate', () => {
      // Admin emails don't sign the click-wrap (per Daniel's contract).
      expect(BACKEND_ROLLUP_SRC).toContain('is_admin_bypass');
    });

    it('payout_eligible_cents = balance ONLY when every gate is true', () => {
      expect(BACKEND_ROLLUP_SRC).toMatch(
        /payout_eligible_cents\s*=[\s\S]{0,200}has_balance\s+and\s+signed\s+and\s+whop_connected\s+and\s+payout_ready/,
      );
    });
  });

  describe('affiliate-widget-mounted-on-wallet', () => {
    it('AffiliateWidget is imported and mounted on the wallet money surface', () => {
      // The wallet is the canonical money-surface home for the
      // affiliate share affordance (per DECISION-0010).
      expect(WALLET_SRC).toContain(
        "from '../../design-os/earn/AffiliateWidget'",
      );
      expect(WALLET_SRC).toContain('<AffiliateWidget />');
    });

    it('AffiliateWidget still owns the copy-URL business logic', () => {
      // The wallet-side wrapper (WalletReferralBlock) is a telemetry +
      // seam bridge — the actual copy-to-clipboard behaviour must
      // remain in the design-os primitive so future refactors don't
      // fragment the copy path.
      expect(WIDGET_SRC).toMatch(/copyUrl|copy-url|navigator\.clipboard/);
    });
  });

  describe('affiliate-attribution-endpoint-shape', () => {
    it('backend exposes POST /affiliate/attribution/record', () => {
      expect(BACKEND_AFFILIATE_SRC).toMatch(
        /@router\.post\(\s*['"]\/attribution\/record['"]/,
      );
    });

    it('endpoint accepts (referred_user_id, affiliate_id, ts_ms?)', () => {
      expect(BACKEND_AFFILIATE_SRC).toContain('referred_user_id');
      expect(BACKEND_AFFILIATE_SRC).toContain('affiliate_id');
      // ts_ms is optional so a client retry produces the same payload.
      expect(BACKEND_AFFILIATE_SRC).toContain('ts_ms');
    });

    it('endpoint emits the referral_attribution_recorded LCOS topic', () => {
      expect(BACKEND_AFFILIATE_SRC).toContain(
        'referral_attribution_recorded',
      );
    });

    it('endpoint is idempotent via LCOS event dedupe', () => {
      // Client retries must not create duplicate ledger events.
      expect(BACKEND_AFFILIATE_SRC).toMatch(
        /duplicate=True[\s\S]{0,200}event_id/,
      );
    });

    it('endpoint is gated by internal secret (server-to-server only)', () => {
      // Attribution write from a browser context is a security bug —
      // the endpoint must require x-internal-secret.
      expect(BACKEND_AFFILIATE_SRC).toMatch(
        /def\s+record_attribution[\s\S]{0,400}require_internal_secret/,
      );
    });
  });

  describe('affiliate does not touch shell-frozen paths', () => {
    it('affiliate journey never modifies Rust / native code paths', () => {
      // Defense: the wallet + widget layer must remain pure TypeScript.
      // Anything importing from '../../src-tauri/' would fail this.
      expect(WALLET_SRC).not.toContain('src-tauri');
      expect(WIDGET_SRC).not.toContain('src-tauri');
    });
  });
});
