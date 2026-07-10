/**
 * AccountSection · Phase 8 Mount #5 wire tests
 *
 * Verifies the CancellationIntercept modal wire:
 *   1. AccountSection imports CancellationIntercept from the ported
 *      route (source-file contract).
 *   2. AccountSection carries a "Cancel subscription" trigger with a
 *      stable data-testid so the shell / e2e harness can locate it.
 *   3. onKeep + onQuiet handlers exist and close the modal.
 *   4. onQuiet carries a `TODO(phase-9)` marker so the real Whop
 *      cancel-subscription RPC wiring is tracked (guard rail 13).
 *   5. WalletDetail (from Mount #3) still renders alongside the
 *      cancel trigger — Mount #5 is additive to Mount #3, not a
 *      replacement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ACCOUNT_SRC = readFileSync(
  resolve(__dirname, 'AccountSection.tsx'),
  'utf-8',
);

describe('AccountSection · Phase 8 Mount #5', () => {
  it('imports CancellationIntercept from the ported route', () => {
    expect(ACCOUNT_SRC).toMatch(
      /import\s*{\s*CancellationIntercept\s*}\s*from\s*['"]\.\.\/\.\.\/routes\/cancellation-intercept\/CancellationIntercept['"]/,
    );
  });

  it('exposes a "Cancel subscription" trigger with a stable testid', () => {
    // The corner-pinned trigger must be discoverable by the shell
    // e2e harness. Testid stays stable across visual polish passes.
    expect(ACCOUNT_SRC).toContain('data-testid="account-cancel-subscription"');
    expect(ACCOUNT_SRC).toContain('Cancel subscription');
  });

  it('wires onKeep + onQuiet handlers that dismiss the modal', () => {
    // Both callbacks must call setCancelOpen(false) — Keep on the
    // "keep my subscription" path, Quiet on the "cancel anyway" path.
    // The current spec closes the modal on both; the real cancellation
    // RPC lands in a later phase.
    expect(ACCOUNT_SRC).toContain('handleKeepSubscription');
    expect(ACCOUNT_SRC).toContain('handleQuietCancel');
    expect(ACCOUNT_SRC).toMatch(/onKeep=\{handleKeepSubscription\}/);
    expect(ACCOUNT_SRC).toMatch(/onQuiet=\{handleQuietCancel\}/);
    // Guard against a callback that silently no-ops without closing.
    const matches = ACCOUNT_SRC.match(/setCancelOpen\(false\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('carries the TODO(phase-9) marker for the real Whop cancel wire', () => {
    // Guard rail 13 · deferred security P1 work is tracked with an
    // explicit TODO(phase-9). Same discipline applied to the missing
    // Whop cancel-subscription RPC · flag but do not implement in
    // Phase 8.
    expect(ACCOUNT_SRC).toContain('TODO(phase-9)');
  });

  it('preserves the Mount #3 WalletDetail render alongside the trigger', () => {
    // Phase 2 finalization · Option B · WalletDetail is now the
    // SectionComponent of SectionWithFallback (mount pattern changed
    // from bare `<WalletDetail />` to a wrapped mount that falls back
    // to the legacy design-os EarnRoute on crash). The cancel trigger
    // must still render BELOW the wallet mount.
    expect(ACCOUNT_SRC).toMatch(
      /SectionComponent\s*=\s*\{\s*WalletDetail\s*\}/,
    );
    const walletIdx = ACCOUNT_SRC.indexOf('SectionComponent={WalletDetail}');
    const triggerIdx = ACCOUNT_SRC.indexOf('data-testid="account-cancel-subscription"');
    expect(walletIdx).toBeGreaterThan(0);
    expect(triggerIdx).toBeGreaterThan(walletIdx);
  });
});
