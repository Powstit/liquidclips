/**
 * authedFetch · L1 global 401 interceptor · unit contract.
 *
 * Verifies the interceptor's invariants without hitting the real bus:
 *   * Attaches Authorization when a JWT is present
 *   * Skips the header when skipAuthHeader is true
 *   * On 401, clears JWT, preserves the current hash, sets the
 *     sessionStorage redirect key
 *   * Dampener prevents duplicate side-effects within 3s
 *   * consumePostAuthRedirect returns the saved value ONCE then clears
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authedFetch,
  authedFetchJson,
  consumePostAuthRedirect,
  POST_AUTH_REDIRECT_KEY,
  _resetAuthedFetchDampenerForTests,
} from './authedFetch';
import {
  setJwt,
  clearJwt,
  getJwt,
  _resetAuthStorageForTests,
  LICENSE_JWT_STORAGE_KEY,
} from './authStorage';

// jsdom provides window / localStorage / sessionStorage.

beforeEach(() => {
  _resetAuthedFetchDampenerForTests();
  _resetAuthStorageForTests();
  try { window.localStorage.clear(); } catch { /* noop */ }
  try { window.sessionStorage.clear(); } catch { /* noop */ }
  vi.restoreAllMocks();
});

function mockFetch(status: number): void {
  const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    // Return a Response-shaped stub so `.status` / `.ok` / `.json()`
    // work like the real Response.
    return new Response('{}', {
      status,
      headers: init?.headers as HeadersInit,
    });
  });
  // Casting through unknown keeps TS strict-mode happy while still
  // patching the global fetch.
  (globalThis as unknown as { fetch: typeof fetch }).fetch = impl as unknown as typeof fetch;
}

describe('authedFetch · header attach', () => {
  it('attaches Bearer <jwt> when a JWT is stored', async () => {
    setJwt('test-jwt-abc');
    const capturedHeaders: Record<string, string> = {};
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const h = new Headers(init?.headers ?? {});
      h.forEach((v, k) => { capturedHeaders[k] = v; });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await authedFetch('https://api.example.com/me');
    expect(capturedHeaders['authorization']).toBe('Bearer test-jwt-abc');
  });

  it('skips the header when skipAuthHeader=true', async () => {
    setJwt('test-jwt');
    const capturedHeaders: Record<string, string> = {};
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const h = new Headers(init?.headers ?? {});
      h.forEach((v, k) => { capturedHeaders[k] = v; });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await authedFetch('https://api.example.com/me', { skipAuthHeader: true });
    expect(capturedHeaders['authorization']).toBeUndefined();
  });

  it('does NOT overwrite a caller-supplied Authorization header', async () => {
    setJwt('storage-jwt');
    const capturedHeaders: Record<string, string> = {};
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const h = new Headers(init?.headers ?? {});
      h.forEach((v, k) => { capturedHeaders[k] = v; });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await authedFetch('https://api.example.com/me', {
      headers: { authorization: 'Bearer caller-supplied' },
    });
    expect(capturedHeaders['authorization']).toBe('Bearer caller-supplied');
  });
});

describe('authedFetch · 401 interceptor', () => {
  it('clears the stored JWT on 401', async () => {
    setJwt('stale-jwt');
    expect(getJwt()).toBe('stale-jwt');
    mockFetch(401);
    await authedFetch('https://api.example.com/me');
    expect(getJwt()).toBeNull();
  });

  it('preserves the current hash in sessionStorage on 401', async () => {
    setJwt('stale-jwt');
    // Set a hash first — jsdom lets us mutate location.hash directly.
    window.location.hash = '#/campaigns';
    mockFetch(401);
    await authedFetch('https://api.example.com/me');
    expect(window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY)).toBe('#/campaigns');
  });

  it('does NOT preserve the hash when the hash is empty', async () => {
    setJwt('stale-jwt');
    window.location.hash = '';
    mockFetch(401);
    await authedFetch('https://api.example.com/me');
    expect(window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY)).toBeNull();
  });

  it('idempotent dampener · second 401 within 3s does NOT re-fire side-effects', async () => {
    setJwt('stale-jwt-1');
    window.location.hash = '#/campaigns';
    mockFetch(401);
    await authedFetch('https://api.example.com/me');
    expect(getJwt()).toBeNull();

    // First 401 side-effects have run. Set a new JWT + hash to prove
    // the second 401 does NOT clobber them.
    setJwt('stale-jwt-2');
    window.location.hash = '#/workstation';
    await authedFetch('https://api.example.com/sync');
    // Dampener kept the second 401 quiet — JWT survives.
    expect(getJwt()).toBe('stale-jwt-2');
    // Preserved hash stayed on the first drop (never overwritten).
    expect(window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY)).toBe('#/campaigns');
  });

  it('skips the interceptor when skip401Handler=true (activation orchestrator branch)', async () => {
    setJwt('some-jwt');
    mockFetch(401);
    await authedFetch('https://api.example.com/me', { skip401Handler: true });
    // JWT still there — the caller (activation orchestrator) owns
    // clearing it.
    expect(getJwt()).toBe('some-jwt');
  });
});

describe('consumePostAuthRedirect', () => {
  it('returns the stored value ONCE then clears the key', () => {
    window.sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, '#/campaigns');
    expect(consumePostAuthRedirect()).toBe('#/campaigns');
    expect(window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY)).toBeNull();
    // Idempotency · second consume returns null.
    expect(consumePostAuthRedirect()).toBeNull();
  });

  it('refuses values that are not #/route shaped (defence in depth)', () => {
    window.sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, 'https://evil.example');
    expect(consumePostAuthRedirect()).toBeNull();
    // Bad value still deleted so nothing persists.
    expect(window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY)).toBeNull();
  });

  it('accepts #/route with query string', () => {
    window.sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, '#/campaigns?tab=my');
    expect(consumePostAuthRedirect()).toBe('#/campaigns?tab=my');
  });
});

describe('authedFetchJson · convenience wrapper', () => {
  it('sets content-type=application/json on POST', async () => {
    setJwt('jwt');
    const captured: { headers: Record<string, string>; body?: unknown } = { headers: {} };
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const h = new Headers(init?.headers ?? {});
      h.forEach((v, k) => { captured.headers[k] = v; });
      captured.body = init?.body;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await authedFetchJson('https://api.example.com/foo', {
      method: 'POST',
      body: { hello: 'world' },
    });
    expect(captured.headers['content-type']).toBe('application/json');
    expect(captured.body).toBe(JSON.stringify({ hello: 'world' }));
  });
});

describe('LICENSE_JWT_STORAGE_KEY parity guard', () => {
  it('authStorage still exports the canonical key name (guards ReferralPipelineTile fix)', () => {
    // Prior version of ReferralPipelineTile read the WRONG key
    // (`lc:license-jwt`). authedFetch now goes through getJwt so the
    // canonical key is used. If this constant name ever moves, the
    // wrong-key regression would surface again.
    expect(LICENSE_JWT_STORAGE_KEY).toBe('lc.license.jwt.v1');
    // Note · clearJwt exercises the same storage adapter.
    setJwt('jwt-to-clear');
    clearJwt();
    expect(getJwt()).toBeNull();
  });
});
