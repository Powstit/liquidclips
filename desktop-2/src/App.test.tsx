/**
 * App · AuthGate · 2.2.24 sign-in surface pivot wire tests
 *
 * Verifies the pass-through AuthGate + Whop-checkout-URL sign-in flow.
 * Phase 8 Mount #1 (LoginActivation + LoginOnboarding rollback) was
 * removed in 2.2.24 — the whole in-app auth chrome collapsed to a
 * single "Sign in" pill in TopHud that opens Whop's hosted checkout
 * in the OS default browser. -1,600 LOC across:
 *   · design-os/routes/LoginOnboarding.tsx (dead-code rollback fallback)
 *   · routes/login-activation/LoginActivation.tsx (Mount #1 canonical)
 *   · lib/useAuthPanelBridge.ts (in-app OAuth webview machinery)
 *
 * Testing note: same source-file assertion pattern as the pre-pivot
 * suite — safer than pulling in Suspense-aware SSR helpers, and
 * catches accidental regressions if a follow-up sprint re-introduces
 * the auth chrome.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_SRC = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');

describe('AuthGate · 2.2.24 sign-in surface pivot', () => {
  it('imports openSignInOrSignUpBridge from whopCheckout helper', () => {
    // 2026-07-05 · ship-day walk fix · pill routes to the account-app
    // /connect-desktop bridge which surfaces BOTH sign-in and sign-up
    // paths, not the raw Whop checkout URL.
    expect(APP_SRC).toMatch(/openSignInOrSignUpBridge/);
    expect(APP_SRC).toMatch(/from\s+["']\.\/lib\/whopCheckout["']/);
  });

  it('AuthGate is a pass-through — always renders children', () => {
    // No hasLicense gating on the render branch.
    expect(APP_SRC).toMatch(/return\s+<>\{children\}<\/>/);
  });

  it('does NOT re-introduce the deleted auth surfaces', () => {
    expect(APP_SRC).not.toMatch(/LoginOnboardingRoute/);
    expect(APP_SRC).not.toMatch(/LoginActivation/);
    expect(APP_SRC).not.toMatch(/useAuthPanelBridge/);
  });

  it('bus handler for auth:open-panel opens the sign-in-or-sign-up bridge', () => {
    // Routes to account-app /connect-desktop which lets returning
    // users sign in (Clerk) AND new buyers sign up (WhopBanner).
    expect(APP_SRC).toMatch(/auth:open-panel[\s\S]*?openSignInOrSignUpBridge/);
  });

  it('still preserves IntroSplash + FunnelGate + HardUpdateGate boot sequence', () => {
    expect(APP_SRC).toContain('<HardUpdateGate>');
    expect(APP_SRC).toContain('<IntroSplash');
    expect(APP_SRC).toContain('<FunnelGate>');
  });

  it('does not touch hasJwt / hasJwtKeychainPresence contracts (guard rail 11)', () => {
    // Boot path still imports the synchronous helpers from authStorage —
    // needed for the cold-boot keychain resume decision (hasJwt() +
    // hasJwtKeychainPresence()) BEFORE React mounts.
    expect(APP_SRC).toMatch(/hasJwt,[\s\S]*?hasJwtKeychainPresence/);
    // P0-3 (RC1 state-drift trifecta · 2026-07-11) · AuthGate no longer
    // maintains a local `setHasLicense(hasJwt())` polling loop. The
    // canonical `useAuth()` hook (src/lib/useAuth.ts) fans out from a
    // module-scope subscriber network so every consumer (TopHud,
    // SideNav, MembershipGate, SplashLeaderboard, AuthGate) re-renders
    // on the same tick. Guard rail now asserts AuthGate reads through
    // the canonical hook.
    expect(APP_SRC).toMatch(/import\s*\{\s*useAuth\s*\}\s*from\s*["']\.\/lib\/useAuth["']/);
    expect(APP_SRC).toMatch(/const\s*\{\s*hasJwt:\s*hasLicense\s*\}\s*=\s*useAuth\(\)/);
  });
});
