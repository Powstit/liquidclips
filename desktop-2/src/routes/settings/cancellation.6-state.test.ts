/**
 * cancellation.6-state.test.ts · Train C2 · RC1 sprint · task #110 · L5.
 *
 * Exercises the 6-state cancellation lifecycle exported from
 * `desktop-2/src/routes/cancellation-intercept/CancellationIntercept.tsx`.
 *
 * The 6 canonical lifecycle states derive from authoritative backend
 * fields (User.subscription_status + affiliate agreement freeze +
 * money-rollup withdraw gates). Each state has a specific:
 *   * UI presentation bucket (mapped to legacy CancelState)
 *   * CTA availability rule (keep / quiet / support-only)
 *   * telemetry reason code
 *
 * States exercised:
 *   1. never-subscribed       · trial/expired/unknown → cancel-attempt
 *   2. active                 · paying subscriber     → cancel-attempt
 *   3. cancelling-scheduled   · canceled + paid_until in future → paused-then-back
 *   4. cancelled-past-cutoff  · canceled + cutoff passed → already-cancelled
 *   5. refunded               · refund webhook fired  → already-cancelled (support-only)
 *   6. chargeback             · agreement frozen      → already-cancelled (support-only)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CANCEL_LIFECYCLE_STATES,
  cancelCtaAvailability,
  deriveCancelLifecycleState,
  toPresentationBucket,
} from '../cancellation-intercept/CancellationIntercept';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INTERCEPT_SRC = readFileSync(
  resolve(__dirname, '../cancellation-intercept/CancellationIntercept.tsx'),
  'utf-8',
);

// ─── Fixture-free timestamp helpers ────────────────────────────────
// Any timestamps below are pure temporal anchors relative to `now`.
// They do NOT represent a specific user's real paid_until — the
// derivation function must handle any ISO string, not a magic date.
const NOW_MS = Date.parse('2026-07-12T12:00:00Z');
const FUTURE_ISO = new Date(NOW_MS + 3 * 24 * 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000).toISOString();

describe('cancellation · 6-state lifecycle · task #110 · L5', () => {
  it('exports all six canonical states in a stable order', () => {
    expect([...CANCEL_LIFECYCLE_STATES]).toEqual([
      'never-subscribed',
      'active',
      'cancelling-scheduled',
      'cancelled-past-cutoff',
      'refunded',
      'chargeback',
    ]);
  });

  describe('state 1 · never-subscribed', () => {
    it("returns 'never-subscribed' for a trial user", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'trial',
        paidUntil: null,
        agreementSigned: null,
        nowMs: NOW_MS,
      });
      expect(key).toBe('never-subscribed');
    });

    it("returns 'never-subscribed' for an expired user with no history", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'expired',
        paidUntil: null,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('never-subscribed');
    });

    it("returns 'never-subscribed' when subscription_status is null", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: null,
        paidUntil: null,
        agreementSigned: null,
      });
      expect(key).toBe('never-subscribed');
    });

    it('presentation bucket is cancel-attempt (offer signup)', () => {
      expect(toPresentationBucket('never-subscribed')).toBe('cancel-attempt');
    });

    it('CTA · keep=true · quiet=false (no active sub to cancel)', () => {
      const cta = cancelCtaAvailability('never-subscribed');
      expect(cta.keepEnabled).toBe(true);
      expect(cta.quietEnabled).toBe(false);
      expect(cta.supportOnly).toBe(false);
    });
  });

  describe('state 2 · active', () => {
    it("returns 'active' for a paying subscriber", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'active',
        paidUntil: FUTURE_ISO,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('active');
    });

    it('presentation bucket is cancel-attempt (default modal)', () => {
      expect(toPresentationBucket('active')).toBe('cancel-attempt');
    });

    it('CTA · keep=true · quiet=true (real cancel path available)', () => {
      const cta = cancelCtaAvailability('active');
      expect(cta.keepEnabled).toBe(true);
      expect(cta.quietEnabled).toBe(true);
      expect(cta.supportOnly).toBe(false);
    });
  });

  describe('state 3 · cancelling-scheduled', () => {
    it("returns 'cancelling-scheduled' when canceled but paid_until is future", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'canceled',
        paidUntil: FUTURE_ISO,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('cancelling-scheduled');
    });

    it("accepts 'cancelled' spelling as an alias", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'cancelled',
        paidUntil: FUTURE_ISO,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('cancelling-scheduled');
    });

    it('presentation bucket is paused-then-back (grace period)', () => {
      expect(toPresentationBucket('cancelling-scheduled')).toBe(
        'paused-then-back',
      );
    });

    it('CTA · keep=true (reactivate) · quiet=false (already scheduled)', () => {
      const cta = cancelCtaAvailability('cancelling-scheduled');
      expect(cta.keepEnabled).toBe(true);
      expect(cta.quietEnabled).toBe(false);
      expect(cta.supportOnly).toBe(false);
    });
  });

  describe('state 4 · cancelled-past-cutoff', () => {
    it("returns 'cancelled-past-cutoff' when paid_until has passed", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'canceled',
        paidUntil: PAST_ISO,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('cancelled-past-cutoff');
    });

    it("returns 'cancelled-past-cutoff' when paid_until is missing", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'canceled',
        paidUntil: null,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('cancelled-past-cutoff');
    });

    it('presentation bucket is already-cancelled', () => {
      expect(toPresentationBucket('cancelled-past-cutoff')).toBe(
        'already-cancelled',
      );
    });

    it('CTA · keep=true (reactivate) · quiet=false', () => {
      const cta = cancelCtaAvailability('cancelled-past-cutoff');
      expect(cta.keepEnabled).toBe(true);
      expect(cta.quietEnabled).toBe(false);
      expect(cta.supportOnly).toBe(false);
    });
  });

  describe('state 5 · refunded', () => {
    it("returns 'refunded' when Whop refund fired", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'refunded',
        paidUntil: PAST_ISO,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('refunded');
    });

    it('presentation bucket is already-cancelled', () => {
      expect(toPresentationBucket('refunded')).toBe('already-cancelled');
    });

    it('CTA · support-only (no retention loop on a refund)', () => {
      const cta = cancelCtaAvailability('refunded');
      expect(cta.supportOnly).toBe(true);
      expect(cta.keepEnabled).toBe(false);
      expect(cta.quietEnabled).toBe(false);
    });
  });

  describe('state 6 · chargeback', () => {
    it("returns 'chargeback' when agreement is frozen", () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'active',
        paidUntil: FUTURE_ISO,
        agreementSigned: false,  // frozen
        nowMs: NOW_MS,
      });
      expect(key).toBe('chargeback');
    });

    it('chargeback wins over refund (both blocked but chargeback is stronger)', () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'refunded',
        paidUntil: PAST_ISO,
        agreementSigned: false,
        nowMs: NOW_MS,
      });
      expect(key).toBe('chargeback');
    });

    it('chargeback wins over canceled', () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'canceled',
        paidUntil: FUTURE_ISO,
        agreementSigned: false,
        nowMs: NOW_MS,
      });
      expect(key).toBe('chargeback');
    });

    it('presentation bucket is already-cancelled', () => {
      expect(toPresentationBucket('chargeback')).toBe('already-cancelled');
    });

    it('CTA · support-only (dispute resolution path)', () => {
      const cta = cancelCtaAvailability('chargeback');
      expect(cta.supportOnly).toBe(true);
      expect(cta.keepEnabled).toBe(false);
      expect(cta.quietEnabled).toBe(false);
    });
  });

  describe('state transitions · derivation-order invariants', () => {
    it('chargeback always wins over any status', () => {
      const statuses = ['trial', 'active', 'canceled', 'refunded', 'past_due'];
      for (const status of statuses) {
        const key = deriveCancelLifecycleState({
          subscriptionStatus: status,
          paidUntil: FUTURE_ISO,
          agreementSigned: false,
          nowMs: NOW_MS,
        });
        expect(key).toBe('chargeback');
      }
    });

    it('refunded wins over canceled (dispute resolution owed)', () => {
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'refunded',
        paidUntil: FUTURE_ISO,
        agreementSigned: true,
        nowMs: NOW_MS,
      });
      expect(key).toBe('refunded');
    });

    it('canceled with unknown agreement status falls into normal cancel flow', () => {
      // agreementSigned=null means we don't yet know · we do NOT
      // pessimistically render chargeback. Only false triggers freeze.
      const key = deriveCancelLifecycleState({
        subscriptionStatus: 'canceled',
        paidUntil: PAST_ISO,
        agreementSigned: null,
        nowMs: NOW_MS,
      });
      expect(key).toBe('cancelled-past-cutoff');
    });
  });

  describe('CTA availability · surface guarantees', () => {
    it('every lifecycle state produces a resolvable CTA config', () => {
      // Regression: adding a new lifecycle state without updating
      // cancelCtaAvailability leaves the modal without buttons.
      for (const s of CANCEL_LIFECYCLE_STATES) {
        const cta = cancelCtaAvailability(s);
        // Either keep is enabled OR support-only mode is active.
        expect(cta.keepEnabled || cta.supportOnly).toBe(true);
      }
    });

    it('supportOnly + keepEnabled are mutually exclusive', () => {
      for (const s of CANCEL_LIFECYCLE_STATES) {
        const cta = cancelCtaAvailability(s);
        expect(cta.supportOnly && cta.keepEnabled).toBe(false);
      }
    });
  });

  describe('2026-07-30 · component actually applies toPresentationBucket', () => {
    // Regression: toPresentationBucket() + deriveCancelLifecycleState()
    // were both correctly implemented and unit-tested above, but the
    // component's `state` (the value stateConfig()/zeroStateConfig()
    // actually render from) was a `useState('cancel-attempt')` that
    // NEVER got fed the derived lifecycleState. Every returning user —
    // already cancelled, mid-chargeback-dispute, refunded — saw the
    // same first-time "you're about to lose $99.99!" scare copy
    // regardless of their real account state. The tests above can't
    // catch this because they only exercise the pure functions in
    // isolation, never the component wiring. This file has no
    // @testing-library/react dependency (see AccountSection.mount5.test.ts's
    // documented source-contract pattern), so this follows that same
    // established convention rather than introducing a new one.
    it('calls toPresentationBucket(lifecycleState) to derive `state`, not a hardcoded literal', () => {
      expect(INTERCEPT_SRC).toMatch(
        /setState\(toPresentationBucket\(lifecycleState\)\)/,
      );
    });

    it('does not initialize `state` from a step that ignores lifecycleState', () => {
      // The ONLY bare useState<CancelState> literal allowed is the
      // React-required initial value — it must be corrected by the
      // sync effect on the very next render, which the assertion above
      // already confirms exists. This guards against someone re-adding
      // a *second*, uncorrected hardcoded assignment elsewhere.
      const bareAssignments = INTERCEPT_SRC.match(/setState\('cancel-attempt'\)/g) ?? [];
      expect(bareAssignments.length).toBe(0);
    });

    it('guards the manual keep/quiet transitions with the userAdvancedStateRef flag so a later lifecycleState recompute cannot clobber them', () => {
      expect(INTERCEPT_SRC).toContain('userAdvancedStateRef');
      // Both real user-driven transitions (keep -> paused-then-back,
      // quiet -> already-cancelled) must set the ref before setState.
      expect(INTERCEPT_SRC).toMatch(
        /userAdvancedStateRef\.current = true;\s*\n\s*setState\('paused-then-back'\)/,
      );
      expect(INTERCEPT_SRC).toMatch(
        /userAdvancedStateRef\.current = true;\s*\n\s*setState\('already-cancelled'\)/,
      );
    });
  });
});
