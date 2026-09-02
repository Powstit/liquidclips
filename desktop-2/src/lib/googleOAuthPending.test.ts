/**
 * googleOAuthPending · Crew P1 · unit tests for the OAuth pending-promise
 * bridge that ties the OS-browser flow to the F5 scanner state machine.
 *
 * Covers:
 *   * happy path · deep-link callback with matching state resolves ok
 *   * state mismatch · silent no-op, promise stays pending
 *   * error=DENIED · resolves as OAuthResult with error=DENIED
 *   * timeout · elapses without a callback → error=TIMEOUT
 *   * superseded flow · starting a new awaitGoogleOAuth cancels prev
 *   * nonce mint · returns a 22+ char string, unique per call
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  awaitGoogleOAuth,
  resolvePendingGoogleOAuth,
  hasPendingGoogleOAuth,
  mintOAuthNonce,
  _resetGoogleOAuthPendingForTests,
} from './googleOAuthPending';

describe('googleOAuthPending', () => {
  beforeEach(() => {
    _resetGoogleOAuthPendingForTests();
  });

  afterEach(() => {
    _resetGoogleOAuthPendingForTests();
  });

  it('resolves with ok=true when the deep-link callback matches the state', async () => {
    const state = 'nonce-happy-path';
    const promise = awaitGoogleOAuth({ state, timeoutMs: 5_000 });
    expect(hasPendingGoogleOAuth()).toBe(true);
    resolvePendingGoogleOAuth(
      `liquidclips://google-oauth?token=at-abc&refresh=rt-xyz&expires_at=${Date.now() + 3600_000}&state=${state}`,
    );
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.access).toBe('at-abc');
      expect(result.tokens.refresh).toBe('rt-xyz');
      expect(result.tokens.scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(result.tokens.scope).toContain('https://www.googleapis.com/auth/contacts.readonly');
    }
    expect(hasPendingGoogleOAuth()).toBe(false);
  });

  it('resolves with error=DENIED when the callback carries error=DENIED', async () => {
    const state = 'nonce-denied';
    const promise = awaitGoogleOAuth({ state, timeoutMs: 5_000 });
    resolvePendingGoogleOAuth(
      `liquidclips://google-oauth?error=DENIED&state=${state}`,
    );
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('DENIED');
    }
  });

  it('resolves with error=MISCONFIGURED when the callback carries MISCONFIGURED', async () => {
    const state = 'nonce-misconfigured';
    const promise = awaitGoogleOAuth({ state, timeoutMs: 5_000 });
    resolvePendingGoogleOAuth(
      `liquidclips://google-oauth?error=MISCONFIGURED&state=${state}`,
    );
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('MISCONFIGURED');
    }
  });

  it('maps an unrecognised backend error code to NETWORK, not DENIED (Bucket 2.6)', async () => {
    // Regression for the "you said no to Google" false-denial bug: any
    // backend error the deep-link carries that ISN'T DENIED/MISCONFIGURED
    // /NETWORK (e.g. auth_google.py's TOKEN_EXCHANGE_FAILED or MALFORMED)
    // must NOT collapse to DENIED — F5Scanner treats error==='DENIED' as
    // "user clicked deny" and shows a false "you said no" message for
    // what was actually a backend/token-exchange failure.
    const state = 'nonce-token-exchange-failed';
    const promise = awaitGoogleOAuth({ state, timeoutMs: 5_000 });
    resolvePendingGoogleOAuth(
      `liquidclips://google-oauth?error=TOKEN_EXCHANGE_FAILED&state=${state}`,
    );
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe('DENIED');
      expect(result.error).toBe('NETWORK');
      // The real backend code is preserved for diagnostics.
      expect(result.note).toContain('TOKEN_EXCHANGE_FAILED');
    }
  });

  it('silently no-ops on state mismatch (leaves pending promise alive)', () => {
    const promise = awaitGoogleOAuth({ state: 'A', timeoutMs: 5_000 });
    void promise;
    resolvePendingGoogleOAuth('liquidclips://google-oauth?token=xxx&state=B');
    // Still pending — the wrong nonce did not settle the promise.
    expect(hasPendingGoogleOAuth()).toBe(true);
  });

  it('cancels the previous flow when a new awaitGoogleOAuth starts', async () => {
    const first = awaitGoogleOAuth({ state: 'first', timeoutMs: 60_000 });
    // Start a new flow before the first settles.
    void awaitGoogleOAuth({ state: 'second', timeoutMs: 60_000 });
    const result = await first;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('TIMEOUT');
    }
  });

  it('resolves with TIMEOUT when no callback arrives before deadline', async () => {
    const promise = awaitGoogleOAuth({ state: 'nonce-timeout', timeoutMs: 60 });
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('TIMEOUT');
    }
  });

  it('mints unique, URL-safe nonces', () => {
    const a = mintOAuthNonce();
    const b = mintOAuthNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
