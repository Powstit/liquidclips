/**
 * contactScan · Bucket 2.6 forensic instrumentation (2026-09-02)
 *
 * Real incident: "LINK MY EMAIL" showed a raw "status 403" with no way
 * to tell (a) which of the two Google endpoints (People vs Gmail)
 * rejected the call, or (b) what Google's own error reason actually
 * was. These tests pin the new diagnostic surface: `source` tags which
 * endpoint failed, `googleError` carries the safe (non-secret,
 * non-PII) subset of Google's error JSON body through to the caller —
 * status/reason/message only, never the token, never contact content.
 */

import { describe, it, expect } from 'vitest';
import { scanContacts, type HttpFetch, type HttpResponse } from './contactScan';

function fetchReturning(peopleRes: HttpResponse, gmailRes: HttpResponse): HttpFetch {
  return async ({ url }) => {
    if (url.includes('people.googleapis.com')) return peopleRes;
    if (url.includes('gmail.googleapis.com')) return gmailRes;
    throw new Error(`unexpected url: ${url}`);
  };
}

const GOOGLE_403_BODY = {
  error: {
    code: 403,
    message: 'Gmail API has not been used in project 581964814058 before or it is disabled.',
    status: 'PERMISSION_DENIED',
    errors: [{ message: 'Gmail API has not been used...', domain: 'usageLimits', reason: 'accessNotConfigured' }],
  },
};

describe('contactScan · diagnostic surface (Bucket 2.6)', () => {
  it('tags a Gmail 403 with source="gmail" and extracts the safe Google error fields', async () => {
    const result = await scanContacts({
      fetch: fetchReturning(
        { status: 200, body: { connections: [] } },
        { status: 403, body: GOOGLE_403_BODY },
      ),
      accessToken: 'fake-token-not-real',
      sleep: async () => undefined,
      maxRetries: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('AUTH_INVALID');
      expect(result.source).toBe('gmail');
      expect(result.googleError?.status).toBe('PERMISSION_DENIED');
      expect(result.googleError?.reason).toBe('accessNotConfigured');
      expect(result.googleError?.message).toContain('Gmail API has not been used');
    }
  });

  it('tags a People API 403 with source="people"', async () => {
    const result = await scanContacts({
      fetch: fetchReturning(
        { status: 403, body: GOOGLE_403_BODY },
        { status: 200, body: { sent: [] } },
      ),
      accessToken: 'fake-token-not-real',
      sleep: async () => undefined,
      maxRetries: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.source).toBe('people');
    }
  });

  it('never surfaces the access token or a full raw body in the error detail', async () => {
    const result = await scanContacts({
      fetch: fetchReturning(
        { status: 200, body: { connections: [] } },
        { status: 403, body: GOOGLE_403_BODY },
      ),
      accessToken: 'super-secret-token-must-never-leak',
      sleep: async () => undefined,
      maxRetries: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.googleError ?? {});
      expect(serialized).not.toContain('super-secret-token-must-never-leak');
      // Only the known-safe keys are present.
      expect(Object.keys(result.googleError ?? {}).sort()).toEqual(
        ['errors_reasons', 'message', 'reason', 'status'].sort(),
      );
    }
  });

  it('handles a non-JSON / unexpected error body without throwing (googleError undefined)', async () => {
    const result = await scanContacts({
      fetch: fetchReturning(
        { status: 200, body: { connections: [] } },
        { status: 403, body: 'plain text error, not the expected shape' },
      ),
      accessToken: 'fake-token-not-real',
      sleep: async () => undefined,
      maxRetries: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.googleError).toBeUndefined();
      expect(result.source).toBe('gmail');
    }
  });
});
