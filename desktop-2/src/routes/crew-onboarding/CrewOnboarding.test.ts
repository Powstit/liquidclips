/**
 * CrewOnboarding · Priority 1 Crew agent · source-file contract tests.
 *
 * These are source-file grep tests (matching the shipped conventions
 * for OutreachSection.test.ts) — they enforce that the component:
 *   * Fires POST /onboarding/crew/shown on mount (server-side marker)
 *   * Fires POST /onboarding/crew/completed after invitations send
 *   * Fires POST /onboarding/crew/dismissed on "Skip forever"
 *   * Reads real /me/crew/match — never uses hardcoded roster
 *   * Reads real /me/crew/invites/send — never opens mailto: fallback
 *   * Uses productionOAuthDriver as its default driver
 *
 * A React-DOM integration harness lives in the e2e journey suite
 * (not shipped in this file) — this suite catches source drift fast.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(name: string): string {
  return readFileSync(resolve(__dirname, name), 'utf-8');
}

describe('CrewOnboarding source contract', () => {
  const src = readSrc('CrewOnboarding.tsx');

  it('fires POST /onboarding/crew/shown on mount', () => {
    expect(src).toContain('/onboarding/crew/shown');
  });

  it('fires POST /onboarding/crew/completed after invitations send', () => {
    expect(src).toContain('/onboarding/crew/completed');
  });

  it('fires POST /onboarding/crew/dismissed on Skip forever', () => {
    expect(src).toContain('/onboarding/crew/dismissed');
  });

  it('reads matches from the real backend endpoint', () => {
    expect(src).toContain('/me/crew/match');
  });

  it('sends invites through the real backend endpoint', () => {
    expect(src).toContain('/me/crew/invites/send');
  });

  it('imports the production OAuth / HTTP / batch-lookup drivers', () => {
    expect(src).toContain('productionOAuthDriver');
    expect(src).toContain('productionHttpFetch');
    expect(src).toContain('productionBatchLookup');
  });

  it('never persists tokens to localStorage', () => {
    expect(src).not.toContain('localStorage.setItem("google');
    expect(src).not.toContain("localStorage.setItem('google");
    // access/refresh tokens must never leak from memory. Sanity check
    // that the F5 scanner tokens don't reach any storage API here.
    expect(src).not.toMatch(/localStorage\.setItem\([^)]*access/i);
    expect(src).not.toMatch(/localStorage\.setItem\([^)]*refresh/i);
  });

  it('never invents MRR numbers from a fixed multiplier', () => {
    // We show real earning_potential_cents from /me/crew/match.
    expect(src).toContain('earning_potential_cents');
    // Prohibited fake-multiplier patterns from the original mock.
    expect(src).not.toMatch(/count\s*\*\s*PRICE_PER_REFERRAL/);
    expect(src).not.toMatch(/DEMO_ROSTER/);
  });

  it('surfaces an honest empty state when zero matches return', () => {
    expect(src).toContain("phase === 'empty'");
    // Empty branch must not display a fabricated MRR value.
    // We reference the referral_share_url in the empty state instead.
    expect(src).toContain('referral_share_url');
  });

  it('exposes the canonical Daniel-approved reveal copy verbatim', () => {
    // "Your network could generate an estimated $900 in monthly recurring
    // revenue." — the number comes from earning_potential_cents so the
    // literal $900 does not appear in code. The framing does:
    expect(src).toContain('in monthly recurring revenue');
    expect(src).toContain('That could pay for your subscription and dinner lol');
  });
});

describe('OutreachSection · production driver contract (crew-onboarding-real-driver rule)', () => {
  const src = readFileSync(
    resolve(__dirname, '..', '..', 'sections', 'outreach', 'OutreachSection.tsx'),
    'utf-8',
  );

  it('passes productionOAuthDriver / productionHttpFetch / productionBatchLookup', () => {
    expect(src).toContain('productionOAuthDriver');
    expect(src).toContain('productionHttpFetch');
    expect(src).toContain('productionBatchLookup');
  });

  it('does NOT import demo drivers', () => {
    expect(src).not.toContain('demoOAuthDriver');
    expect(src).not.toContain('demoHttpFetch');
    expect(src).not.toContain('demoBatchLookup');
  });
});

describe('SyncMailMoneyDrop · demo driver dev-only guard', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'sync-mail-money-drop', 'SyncMailMoneyDrop.tsx'),
    'utf-8',
  );

  it('gates demo drivers behind an isDev boundary', () => {
    // The DEV guard exists so production builds never fall back to
    // demoOAuthDriver / demoHttpFetch / demoBatchLookup. The literal
    // pattern is `(isDev ? demoOAuthDriver : null)`.
    expect(src).toMatch(/\(isDev\s*\?\s*demoOAuthDriver/);
    expect(src).toMatch(/\(isDev\s*\?\s*demoHttpFetch/);
    expect(src).toMatch(/\(isDev\s*\?\s*demoBatchLookup/);
  });

  it('shows the friendly MISCONFIGURED copy when clientId absent in prod', () => {
    // The source uses `isn\'t` (escaped single-quote in single-quoted string).
    // On disk that literal is 5 chars: i s n \ ' t. Match tolerant of
    // straight `'`, backslash-escaped `\'`, or curly `’`.
    expect(src).toContain('Google connection');
    expect(src).toMatch(/isn.{0,2}t set up yet/);
  });
});
