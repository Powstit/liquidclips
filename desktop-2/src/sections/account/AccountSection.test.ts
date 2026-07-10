/**
 * AccountSection · Phase 8 Mount #3 + C1-T1 wire tests
 *
 * Verifies WalletDetail is now the AccountSection surface AND that
 * WalletDetail no longer contains hardcoded roster fixtures:
 *   1. AccountSection module imports WalletDetail from the ported
 *      route (source-file contract).
 *   2. AccountSection module NO LONGER imports the fakeAccount
 *      fixture (the stub HUD cards are gone).
 *   3. The section registry still resolves `#/account` to the
 *      AccountSection component (no regression on the router entry).
 *   4. WalletDetail is real-data-driven per C1-T1 (2026-07-05):
 *      wires to useWalletLedger, no fictional roster names, no
 *      real creator emails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { AccountSection } from './AccountSection';
import { SECTION_IDS } from '../../shell/sectionIds';
import { getSectionByRoute } from '../../shell/sectionRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ACCOUNT_SRC = readFileSync(
  resolve(__dirname, 'AccountSection.tsx'),
  'utf-8',
);
const WALLET_SRC = readFileSync(
  resolve(__dirname, '../../routes/wallet-detail/WalletDetail.tsx'),
  'utf-8',
);

describe('AccountSection · Phase 8 Mount #3', () => {
  it('imports WalletDetail from the ported route', () => {
    expect(ACCOUNT_SRC).toMatch(
      /import\s*{\s*WalletDetail\s*}\s*from\s*['"]\.\.\/\.\.\/routes\/wallet-detail\/WalletDetail['"]/,
    );
  });

  it('no longer imports the stub fakeAccount fixture', () => {
    // The prior placeholder identity / tier / affiliate HUD cards read
    // from `fixtures/fakeAccount.preview`. Mount #3 removed them.
    // (String may still appear in a docstring; the check is on the
    // import statement itself.)
    expect(ACCOUNT_SRC).not.toMatch(/from ['"][^'"]*fakeAccount[^'"]*['"]/);
    expect(ACCOUNT_SRC).not.toMatch(/import\s*{[^}]*fakeAccount/);
  });

  it('renders WalletDetail wrapped in SectionWithFallback (Phase 2 Option B)', () => {
    // Phase 2 finalization · Option B · WalletDetail is now mounted
    // through SectionWithFallback so a runtime crash falls back to the
    // legacy design-os EarnRoute instead of white-screening the money
    // moment. This test guards against a silent revert to bare
    // <WalletDetail /> which would break the fallback chain.
    expect(ACCOUNT_SRC).toContain('SectionWithFallback');
    expect(ACCOUNT_SRC).toMatch(
      /SectionComponent\s*=\s*\{\s*WalletDetail\s*\}/,
    );
    expect(ACCOUNT_SRC).toMatch(
      /FallbackComponent\s*=\s*\{\s*LegacyEarnFallback\s*\}/,
    );
    expect(ACCOUNT_SRC).toMatch(/sectionName\s*=\s*['"]account\/wallet-detail['"]/);
    // The fallback must resolve to a real design-os EarnRoute import
    // (older wallet · uglier but works when the new Section throws).
    expect(ACCOUNT_SRC).toContain('../../design-os/routes/Earn');
    // Also must not have re-introduced the lc-hud-card scaffolding.
    expect(ACCOUNT_SRC).not.toContain('lc-hud-card');
  });

  it('section registry still resolves #/account → AccountSection', () => {
    const entry = getSectionByRoute('account');
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe(SECTION_IDS.SECTION_ACCOUNT);
    expect(entry?.component).toBe(AccountSection);
  });

  it('WalletDetail is wired to real ledger data (C1-T1)', () => {
    // C1-T1 replaced the hardcoded CLIPPERS + DROPS roster with a
    // useWalletLedger hook that fetches /me/wallet/summary. The
    // fictional names from the port mockup must no longer appear
    // as hardcoded strings in the source.
    expect(WALLET_SRC).toMatch(/useWalletLedger/);
    for (const name of [
      'Marcus B.',
      'Chris N.',
      'Ella C.',
      'Alex R.',
      'Amy A.',
      'Jax H.',
      'Clara A.',
      'Cole & Sam',
      'Sasha G.',
      'Maya K.',
    ]) {
      expect(WALLET_SRC).not.toContain(name);
    }
    // Real creator emails must NEVER appear.
    for (const forbiddenEmail of [
      'mkbhd.com',
      'caseyneistat.com',
      'emmachamberlain.com',
      'aliabdaal.com',
      'simonegiertz.com',
      'colinandsamir.com',
      'airrack.tv',
      'cleoabram.com',
    ]) {
      expect(WALLET_SRC).not.toContain(forbiddenEmail);
    }
  });

  it('WalletDetail renders all 5 explicit states (C1-T1 acceptance)', () => {
    expect(WALLET_SRC).toMatch(/data-testid="wallet-loading"/);
    expect(WALLET_SRC).toMatch(/data-testid="wallet-unauthorized"/);
    expect(WALLET_SRC).toMatch(/data-testid="wallet-error"/);
    expect(WALLET_SRC).toMatch(/data-testid="wallet-drops-empty"/);
    expect(WALLET_SRC).toMatch(/data-testid="wallet-expired-banner"/);
  });
});
