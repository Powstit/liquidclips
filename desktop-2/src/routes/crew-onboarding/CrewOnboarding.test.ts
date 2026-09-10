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

describe('CrewOnboarding · native macOS Contacts referral hero (Outreach-style, 2026-09-10)', () => {
  const src = readSrc('CrewOnboarding.tsx');

  it('leads with the Outreach-style referral value prop + a prominent "LINK WITH CONTACT DIRECTLY" CTA', () => {
    // Same big earnings hero the Outreach money-drop screen uses.
    expect(src).toContain('$99.99/mo');
    expect(src).toContain('$50/mo for LIFE');
    expect(src).toContain('crew-onboarding__hero-h1');
    // Prominent primary CTA — mirrors .smmd-connect-btn.
    expect(src).toContain('crew-onboarding__link-contact-btn');
    expect(src).toContain('crew-onboarding__envelope-icon');
    expect(src).toContain('Link with contact directly');
    expect(src).toContain('data-testid="crew-choose-contact"');
    // Supporting copy under the CTA.
    expect(src).toContain('Pick a contact from your device and invite them.');
  });

  it('reuses the shared useNativeContactInvite hook (no second picker)', () => {
    expect(src).toContain("from '../../lib/f5/useNativeContactInvite'");
    expect(src).toContain('useNativeContactInvite(');
    // The native picker itself is only reached through the shared hook —
    // CrewOnboarding must not import pickContactNative directly.
    expect(src).not.toContain("from '../../lib/f5/nativeContactPicker'");
  });

  it('HIDES the Google CTA from onboarding for this iteration WITHOUT deleting the Google code', () => {
    // The button + its testid still exist in the file (commented out),
    // so the Google path can be restored by un-commenting it.
    expect(src).toContain('data-testid="crew-connect-google"');
    expect(src).toContain('Scan my whole network');
    // ...but it must NOT be in an active JSX expression: the only place
    // `onConnect()` is invoked is inside a block comment, and `onConnect`
    // is retained via a `void onConnect;` reference.
    expect(src).toContain('void onConnect;');
    const active = src.replace(/\/\*[\s\S]*?\*\//g, ''); // strip block comments
    expect(active).not.toContain('data-testid="crew-connect-google"');
    expect(active).not.toContain('onClick={() => void onConnect()}');
    // Google scanner infra stays imported + wired.
    expect(src).toContain('productionOAuthDriver');
    expect(src).toContain('F5Scanner');
    expect(src).toContain("phase === 'reveal'");
  });

  it('shows the existing-user dead-end state for a contact that already has an account', () => {
    expect(src).toContain('crew-native-existing-user');
    expect(src).toContain('Already on Liquid Clips');
  });

  it('a non-user native contact goes through /me/crew/match then the shared server invite', () => {
    expect(src).toContain('/me/crew/match');
    expect(src).toContain("body: JSON.stringify({ emails: [email], handles: [] })");
    // native-confirm's "Send invitation" reuses onApproveSend →
    // /me/crew/invites/send. No parallel invite path.
    expect(src).toContain('onApproveSend()');
    expect(src).toContain('/me/crew/invites/send');
  });

  it('never opens a raw mailto:/sms: from onboarding (attribution-safe)', () => {
    // No client-side send mechanism is imported or invoked — the invite
    // is always the tracked server call.
    expect(src).not.toContain('buildSmsUrl');
    expect(src).not.toContain('buildMailtoUrl');
    expect(src).not.toContain('openSmart');
    expect(src).not.toContain("from '../../lib/f5/sendComposer'");
    // No onMessagesChannelChosen is wired — phone-only contacts fall to
    // the manual-email fallback so the invite stays a tracked server one.
    expect(src).not.toContain('onMessagesChannelChosen:');
  });

  it('offers the manual-email fallback for a contact with no saved email', () => {
    expect(src).toContain('crew-native-need-email');
    expect(src).toContain('nativeInvite.setManualEmail');
    expect(src).toContain('nativeInvite.submitManualEmail');
  });

  it('keeps Continue-to-Home / Do this later / Skip forever intact', () => {
    expect(src).toContain('data-testid="crew-do-later"');
    expect(src).toContain('data-testid="crew-skip-forever"');
    expect(src).toContain('Continue to Home');
  });
});

describe('useNativeContactInvite · shared module contract', () => {
  const src = readFileSync(
    resolve(__dirname, '..', '..', 'lib', 'f5', 'useNativeContactInvite.ts'),
    'utf-8',
  );

  it('runs the existing-user K-factor gate via POST /me/contact-check', () => {
    expect(src).toContain('/me/contact-check');
    expect(src).toContain("method: 'POST'");
  });

  it('drives the OS-native single-contact picker, not a bulk enumeration', () => {
    expect(src).toContain('pickContactNative');
    expect(src).not.toContain('CNContactStore');
    expect(src).not.toContain('requestAccess');
  });

  it('never sends anything itself — no openSmart / composer imports', () => {
    expect(src).not.toContain('openSmart');
    expect(src).not.toContain('sendComposer');
    expect(src).not.toContain('buildSmsUrl');
    expect(src).not.toContain('buildMailtoUrl');
  });

  it('a malformed contact-check body is treated as a failure, never as "non-user"', () => {
    expect(src).toContain('contact-check malformed response');
    expect(src).toContain("kind: 'lookup-error'");
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
