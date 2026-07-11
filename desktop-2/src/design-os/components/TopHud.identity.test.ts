/**
 * TopHud · R7 identity pill contract tests.
 *
 * Source-file grep tests matching the shipped convention (see
 * CrewOnboarding.test.ts, App.test.tsx). Enforces the R7 spec:
 *   * TopHud subscribes to `auth:signed-in` on the bus
 *   * TopHud derives a 4-state identity pill from useMe + useTierCaps
 *   * Every state ships a real click destination (no dead clicks)
 *   * The 4 Daniel-locked copy strings are present verbatim
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HUD_SRC = readFileSync(resolve(__dirname, 'TopHud.tsx'), 'utf-8');
const SIDENAV_SRC = readFileSync(
  resolve(__dirname, '..', '..', 'shell', 'SideNav.tsx'),
  'utf-8',
);
const LOGIN_SRC = readFileSync(
  resolve(__dirname, '..', '..', 'components', 'auth', 'SimpleLoginPanel.tsx'),
  'utf-8',
);
const EVENTS_SRC = readFileSync(
  resolve(__dirname, '..', 'bridge', 'events.ts'),
  'utf-8',
);
// P0-3 (RC1 state-drift trifecta · 2026-07-11) · the auth:signed-in
// subscriber previously lived in TopHud's own useEffect. It now lives
// in the module-scope `useAuth()` hook so every consumer subscribes
// once instead of duplicating listeners.
const USE_AUTH_SRC = readFileSync(
  resolve(__dirname, '..', '..', 'lib', 'useAuth.ts'),
  'utf-8',
);

describe('TopHud · R7 identity pill · 4-state contract', () => {
  it('subscribes to auth:signed-in bus event so OTP verify flips the pill', () => {
    // The OTP flow (SimpleLoginPanel) writes JWT via setJwt() but
    // never fires `activation:complete` (reserved for deep-link
    // activation). Without an `auth:signed-in` subscription the pill
    // stayed frozen on "SIGN IN" until a hard reload.
    // P0-3 (RC1 · 2026-07-11): subscription migrated to the canonical
    // `useAuth()` hook. TopHud reads `useAuth()`; the bus subscribe
    // lives in `src/lib/useAuth.ts` at module init.
    expect(HUD_SRC).toMatch(/useAuth\(\)/);
    expect(USE_AUTH_SRC).toMatch(/bus\.on\(\s*["']auth:signed-in["']/);
  });

  it('SimpleLoginPanel emits auth:signed-in after setJwt', () => {
    expect(LOGIN_SRC).toMatch(/bus\.emit\(\s*["']auth:signed-in["']/);
  });

  it('registers auth:signed-in in the LCEvents type union', () => {
    expect(EVENTS_SRC).toContain('"auth:signed-in"');
  });

  it('derives a 4-state identity pill from useMe + useTierCaps', () => {
    expect(HUD_SRC).toMatch(/identityState.*noJwt.*connectWhop.*unlockAgency.*agency/s);
    expect(HUD_SRC).toContain('useMe(');
    expect(HUD_SRC).toContain('useTierCaps(');
    expect(HUD_SRC).toContain('whopUserId');
  });

  it('exposes the 4 Daniel-locked copy strings verbatim', () => {
    expect(HUD_SRC).toContain('Start free · 10 clips');
    expect(HUD_SRC).toContain('Connect Whop');
    expect(HUD_SRC).toContain('Unlock Agency · $99.99');
    // agency state uses `@${handle} · Agency` template.
    expect(HUD_SRC).toMatch(/@\$\{handleFromEmail\}\s+· Agency/);
  });

  it('every pill state has a real click destination · no dead clicks', () => {
    // noJwt          → sign-out event to remount WelcomeGate/SimpleLoginPanel
    expect(HUD_SRC).toContain('lc:welcome-acked');
    expect(HUD_SRC).toMatch(/bus\.emit\(\s*["']auth:signed-out["']\s*,\s*\{\s*reason:\s*["']manual["']/);
    // connectWhop    → connectWhop() OAuth helper
    expect(HUD_SRC).toContain('connectWhop(');
    // unlockAgency   → openWhopFounderCheckout()
    expect(HUD_SRC).toContain('openWhopFounderCheckout(');
    // agency         → opens the avatar menu (setMenuOpen)
    expect(HUD_SRC).toMatch(/case\s+"agency":[\s\S]{0,80}setMenuOpen/);
  });

  it('exposes data-identity-state on the pill for ship-lens / Playwright', () => {
    expect(HUD_SRC).toContain('data-identity-state={identityState}');
  });

  it('does NOT keep the hardcoded "Sign in" copy string in the pill JSX', () => {
    // The old fixed pill said literally "Sign in". If it comes back the
    // 4-state derivation was accidentally reverted.
    // We tolerate the string in comments (`Sign in`) but the JSX must
    // read from `identityCopy`.
    expect(HUD_SRC).toContain('{identityCopy}');
  });
});

describe('SideNav · R7 identity strip · wired to canonical state', () => {
  it('does NOT hardcode "Guest" / "GU" / "Free" strings on render', () => {
    // Prior version:
    //   <div className="lc-nav-user-name">Guest</div>
    //   <div className="lc-nav-user-tier">Free</div>
    //   avatar text: "GU"
    // The literal strings can still appear inside comments or as
    // honest fallbacks in the hook — but they must NOT be the JSX
    // literal that renders unconditionally.
    expect(SIDENAV_SRC).not.toMatch(/className="lc-nav-user-name">Guest</);
    expect(SIDENAV_SRC).not.toMatch(/className="lc-nav-user-tier">Free</);
    // The avatar div previously had `GU` as a direct child text node.
    expect(SIDENAV_SRC).not.toMatch(/<div className="lc-nav-user-avatar">\s*GU\b/);
  });

  it('reads identity from useMe + useTierCaps (same source as TopHud)', () => {
    expect(SIDENAV_SRC).toContain('useMe');
    expect(SIDENAV_SRC).toContain('useTierCaps');
  });

  it('renders "Guest" only as an honest anonymous fallback', () => {
    // The hook maps `null email → "Guest"` — verify the JSX renders
    // `identity.handle` not a hardcoded label.
    expect(SIDENAV_SRC).toContain('{identity.handle}');
    expect(SIDENAV_SRC).toContain('{identity.tierLabel}');
    expect(SIDENAV_SRC).toContain('{identity.initials}');
  });
});
