/**
 * friendlyScanError · Bucket 2.6 incident regression (2026-09-02)
 *
 * Real report: "LINK MY EMAIL" showed a raw "status 403" to the user
 * after Google's People/Gmail API rejected the OAuth token during the
 * F5 contact scan (contactScan.ts's fetchWithRetry attaches
 * `note: "status ${res.status}"` on 401/403/malformed responses, and
 * SyncMailMoneyDrop.tsx used to pass that straight through as the
 * displayed error). These tests pin the mapping to plain-English,
 * actionable copy and confirm a bare status code is never shown raw.
 */

import { describe, it, expect } from 'vitest';
import { friendlyScanError } from './SyncMailMoneyDrop';

describe('friendlyScanError (Bucket 2.6)', () => {
  it('maps "status 403" (the real incident case) to an actionable message, never the raw status', () => {
    const msg = friendlyScanError('status 403');
    expect(msg).not.toContain('403');
    expect(msg).not.toContain('status');
    expect(msg.toLowerCase()).toContain('google');
  });

  it('maps "status 401" the same way as 403 (both are AUTH_INVALID)', () => {
    const msg = friendlyScanError('status 401');
    expect(msg).not.toContain('401');
    expect(msg.toLowerCase()).toContain('connect again');
  });

  it('maps rate-limit (429) to a retry-shortly message', () => {
    const msg = friendlyScanError('status 429');
    expect(msg).not.toContain('429');
    expect(msg.toLowerCase()).toContain('try again');
  });

  it('maps a 5xx to a connectivity message, not a raw status', () => {
    const msg = friendlyScanError('status 503');
    expect(msg).not.toContain('503');
    expect(msg.toLowerCase()).toContain("couldn't reach");
  });

  it('maps a backend callback error note without leaking the internal code', () => {
    const msg = friendlyScanError('callback error=TOKEN_EXCHANGE_FAILED');
    expect(msg).not.toContain('TOKEN_EXCHANGE_FAILED');
    expect(msg.toLowerCase()).toContain('google connection');
  });

  it('never invents a specific cause for an unrecognised note (safe generic fallback)', () => {
    const msg = friendlyScanError('some future error shape we have never seen');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain('some future error shape');
  });

  it('handles a null note without throwing', () => {
    expect(() => friendlyScanError(null)).not.toThrow();
    expect(friendlyScanError(null).length).toBeGreaterThan(0);
  });
});
