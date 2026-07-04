/**
 * AccountSection · Phase 8 Mount #3 wire tests
 *
 * Verifies WalletDetail is now the AccountSection surface:
 *   1. AccountSection module imports WalletDetail from the ported
 *      route (source-file contract).
 *   2. AccountSection module NO LONGER imports the fakeAccount
 *      fixture (the stub HUD cards are gone).
 *   3. The section registry still resolves `#/account` to the
 *      AccountSection component (no regression on the router entry).
 *   4. WalletDetail's CLIPPERS roster stays fictional-only per
 *      guard rail 5 (Marcus B., Chris N., Ella C., Alex R., Amy A.,
 *      Jax H., Clara A., Cole & Sam, Sasha G., Maya K.).
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

  it('renders WalletDetail as its sole body', () => {
    // Source-file guard against a silent revert to the stub HUD cards.
    expect(ACCOUNT_SRC).toContain('<WalletDetail />');
    // Also must not have re-introduced the lc-hud-card scaffolding.
    expect(ACCOUNT_SRC).not.toContain('lc-hud-card');
  });

  it('section registry still resolves #/account → AccountSection', () => {
    const entry = getSectionByRoute('account');
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe(SECTION_IDS.SECTION_ACCOUNT);
    expect(entry?.component).toBe(AccountSection);
  });

  it('WalletDetail CLIPPERS roster stays fictional-only (guard rail 5)', () => {
    // The audit called out real-creator emails as a P0 in Phase 7.
    // Mount #3 must not regress that — the CLIPPERS roster lives in
    // WalletDetail.tsx as hardcoded fixture data.
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
      expect(WALLET_SRC).toContain(name);
    }
    // Real creator emails must NOT appear.
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
});
