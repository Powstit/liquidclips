/**
 * App · AuthGate · Phase 8 Mount #1 wire tests
 *
 * Verifies the LoginActivation-vs-AppShell decision matrix inside
 * `AuthGate` after Mount #1 swapped LoginOnboardingRoute for
 * LoginActivation.
 *
 * Testing note: AuthGate uses `React.lazy(...)` for LoginActivation
 * so the runtime render path requires a `<Suspense>` boundary that
 * `renderToString` does not support. Rather than pull in
 * `renderToPipeableStream` or mock React's internals, this file uses
 * source-file assertions on `App.tsx` — same rigor as the receipt-
 * verify sweeps, and it protects against the mount being silently
 * reverted. The type-level wiring is separately guaranteed by
 * `tsc --noEmit` (which fails on any prop / import drift).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_SRC = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');

describe('AuthGate · Phase 8 Mount #1', () => {
  it('imports LoginActivation as a lazy module', () => {
    expect(APP_SRC).toMatch(
      /const LoginActivation = lazy\([\s\S]*?login-activation\/LoginActivation/,
    );
  });

  it('mounts LoginActivation inside AuthGate for the unauth branch', () => {
    // The unauth render must be LoginActivation, not the old
    // LoginOnboardingRoute path. The `onContinue` wire triggers a
    // best-effort keychain resume when the user finishes the flow.
    expect(APP_SRC).toMatch(/<LoginActivation[\s\S]*?onContinue/);
    // Assert the AuthGate no longer directly renders LoginOnboardingRoute.
    expect(APP_SRC).not.toMatch(/return\s+<LoginOnboardingRoute\s*\/>/);
  });

  it('preserves LoginOnboardingRoute as a rollback breadcrumb', () => {
    // Import must remain so a rollback is a one-liner swap in AuthGate.
    expect(APP_SRC).toMatch(
      /const LoginOnboardingRoute = lazy\([\s\S]*?LoginOnboarding/,
    );
    // The `void LoginOnboardingRoute` reference keeps tsc's
    // noUnusedLocals from stripping the dead-code import.
    expect(APP_SRC).toContain('void LoginOnboardingRoute');
  });

  it('does not touch hasJwt / hasJwtKeychainPresence contracts (guard rail 11)', () => {
    // Both symbols must still be imported and used from authStorage —
    // Mount #1 explicitly promised UNCHANGED behavior here.
    expect(APP_SRC).toMatch(/hasJwt,[\s\S]*?hasJwtKeychainPresence/);
    // AuthGate still uses `hasJwt()` for the license snapshot.
    expect(APP_SRC).toMatch(/setHasLicense\(hasJwt\(\)\)/);
  });

  it('preserves IntroSplash + FunnelGate + HardUpdateGate boot sequence', () => {
    // Guard against a Mount #1 refactor accidentally collapsing the
    // pre-auth boot chrome. All three must still render around the
    // AuthGate branch.
    expect(APP_SRC).toContain('<HardUpdateGate>');
    expect(APP_SRC).toContain('<IntroSplash');
    expect(APP_SRC).toContain('<FunnelGate>');
  });
});
