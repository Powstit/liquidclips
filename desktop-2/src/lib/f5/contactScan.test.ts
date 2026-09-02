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

// ─────────────────────────────────────────────────────────────
// Bucket 2.7 (2026-09-02) · Gmail metadata hydration — the actual fix.
//
// Real bug: messages.list was parsed as if it already carried `to`
// recipient data. It never has — Gmail's list endpoint returns only
// {id, threadId}. This suite proves the two-call fix (list, then
// per-message metadata GET) end to end, with a fetch mock shaped
// exactly like Gmail's real API (not the old hand-wavy {sent:[...]}
// shape the previous tests used).
// ─────────────────────────────────────────────────────────────

interface MockSentMessage { id: string; toHeaderValue?: string; missingToHeader?: boolean }

function mkGmailAwareFetch(args: {
  people?: HttpResponse;
  sentMessages: MockSentMessage[];
  listStatus?: number;
  metadataStatusFor?: Record<string, number>;
  urlsSeen?: string[];
}): HttpFetch {
  return async ({ url }) => {
    args.urlsSeen?.push(url);
    if (url.includes('people.googleapis.com')) {
      return args.people ?? { status: 200, body: { connections: [] } };
    }
    if (url.includes('gmail.googleapis.com')) {
      const getMatch = url.match(/\/messages\/([^/?]+)\?(.+)/);
      if (getMatch) {
        const id = getMatch[1];
        const qs = getMatch[2];
        const status = args.metadataStatusFor?.[id] ?? 200;
        if (status !== 200) return { status, body: { error: { status: 'PERMISSION_DENIED', message: 'nope' } } };
        const msg = args.sentMessages.find((m) => m.id === id);
        // Assert-by-construction: real code must request metadata form,
        // never full body. Encode that expectation directly in the mock.
        if (!qs.includes('format=metadata')) {
          throw new Error(`mock: expected format=metadata in ${url}`);
        }
        if (qs.includes('format=full')) {
          throw new Error(`mock: must never request format=full (${url})`);
        }
        if (!msg || msg.missingToHeader) {
          return { status: 200, body: { payload: { headers: [] } } };
        }
        return { status: 200, body: { payload: { headers: [{ name: 'To', value: msg.toHeaderValue }] } } };
      }
      return {
        status: args.listStatus ?? 200,
        body: { messages: args.sentMessages.map((m) => ({ id: m.id, threadId: `t_${m.id}` })) },
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };
}

describe('contactScan · Gmail metadata hydration (Bucket 2.7)', () => {
  it('1. messages.list returns only message IDs/thread IDs — the list call never carries recipient data', async () => {
    const urlsSeen: string[] = [];
    const fetch = mkGmailAwareFetch({ sentMessages: [{ id: 'm1', toHeaderValue: 'a@x.com' }], urlsSeen });
    await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    const listUrl = urlsSeen.find((u) => u.includes('gmail.googleapis.com') && !u.includes('/messages/'));
    expect(listUrl).toBeDefined();
    expect(listUrl).toContain('labelIds=SENT');
    expect(listUrl).not.toContain('/messages/m1');
  });

  it('2. the scanner hydrates metadata correctly — issues a real messages.get per listed id', async () => {
    const urlsSeen: string[] = [];
    const fetch = mkGmailAwareFetch({
      sentMessages: [{ id: 'm1', toHeaderValue: 'a@x.com' }, { id: 'm2', toHeaderValue: 'b@x.com' }],
      urlsSeen,
    });
    await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    expect(urlsSeen.some((u) => u.includes('/messages/m1?'))).toBe(true);
    expect(urlsSeen.some((u) => u.includes('/messages/m2?'))).toBe(true);
  });

  it('3. To headers are extracted correctly into contact sentCount', async () => {
    const fetch = mkGmailAwareFetch({
      sentMessages: [
        { id: 'm1', toHeaderValue: 'alex@daily-podcast.com' },
        { id: 'm2', toHeaderValue: 'alex@daily-podcast.com' },
      ],
    });
    const result = await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const alex = result.contacts.find((c) => c.email === 'alex@daily-podcast.com');
      expect(alex?.sentCount).toBe(2);
    }
  });

  it('4. multiple recipients on one message are all handled correctly', async () => {
    const fetch = mkGmailAwareFetch({
      sentMessages: [{ id: 'm1', toHeaderValue: 'Jane Doe <jane@example.com>, bob@example.com, "Smith, John" <john@example.com>' }],
    });
    const result = await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const emails = result.contacts.map((c) => c.email).sort();
      expect(emails).toEqual(['bob@example.com', 'jane@example.com', 'john@example.com']);
    }
  });

  it('5. malformed/missing To headers do not crash the scanner', async () => {
    const fetch = mkGmailAwareFetch({
      sentMessages: [
        { id: 'm1', missingToHeader: true },
        { id: 'm2', toHeaderValue: '' },
        { id: 'm3', toHeaderValue: 'not-an-email-at-all' },
        { id: 'm4', toHeaderValue: 'real@example.com' },
      ],
    });
    const result = await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contacts.map((c) => c.email)).toEqual(['real@example.com']);
    }
  });

  it('6a. Gmail auth error during hydration (401/403) is surfaced safely, not thrown', async () => {
    const fetch = mkGmailAwareFetch({
      sentMessages: [{ id: 'm1', toHeaderValue: 'a@x.com' }],
      metadataStatusFor: { m1: 403 },
    });
    const result = await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('AUTH_INVALID');
      expect(result.source).toBe('gmail');
    }
  });

  it('6b. a non-auth per-message hydration failure is skipped, scan still succeeds with the rest', async () => {
    const fetch = mkGmailAwareFetch({
      sentMessages: [
        { id: 'm1', toHeaderValue: 'good@example.com' },
        { id: 'm2', toHeaderValue: 'also-good@example.com' },
      ],
      metadataStatusFor: { m2: 500 },
    });
    const result = await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contacts.map((c) => c.email)).toContain('good@example.com');
    }
  });

  it('7. never requests message body — only format=metadata&metadataHeaders=To, never format=full', async () => {
    const urlsSeen: string[] = [];
    const fetch = mkGmailAwareFetch({ sentMessages: [{ id: 'm1', toHeaderValue: 'a@x.com' }], urlsSeen });
    await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    const getUrl = urlsSeen.find((u) => u.includes('/messages/m1'));
    expect(getUrl).toContain('format=metadata');
    expect(getUrl).toContain('metadataHeaders=To');
    expect(getUrl).not.toContain('format=full');
  });

  it('caps hydration at GMAIL_METADATA_HYDRATE_LIMIT even when the list returns more ids', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, toHeaderValue: `u${i}@example.com` }));
    const urlsSeen: string[] = [];
    const fetch = mkGmailAwareFetch({ sentMessages: many, urlsSeen });
    await scanContacts({ fetch, accessToken: 'tok', sleep: async () => undefined, maxRetries: 0 });
    const getCalls = urlsSeen.filter((u) => u.includes('gmail.googleapis.com') && u.includes('/messages/'));
    expect(getCalls.length).toBeLessThanOrEqual(50);
  });
});

describe('gmail scope — production request never uses gmail.readonly (Bucket 2.7, items 8-9)', () => {
  it('8. REQUIRED_SCOPES requests gmail.metadata', async () => {
    const { REQUIRED_SCOPES } = await import('./googleOAuth');
    expect(REQUIRED_SCOPES).toContain('https://www.googleapis.com/auth/gmail.metadata');
  });

  it('9. gmail.readonly is not requested by REQUIRED_SCOPES, and the literal scope string does not appear as live code in the production OAuth files', async () => {
    const { REQUIRED_SCOPES } = await import('./googleOAuth');
    expect(REQUIRED_SCOPES as readonly string[]).not.toContain('https://www.googleapis.com/auth/gmail.readonly');

    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const productionFiles = [
      path.resolve(dir, 'googleOAuth.ts'),
      path.resolve(dir, '../googleOAuthPending.ts'),
      path.resolve(dir, '../../routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx'),
    ];
    const forbiddenLiteral = "'https://www.googleapis.com/auth/gmail.readonly'";
    const forbiddenLiteralDq = '"https://www.googleapis.com/auth/gmail.readonly"';
    for (const file of productionFiles) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src.includes(forbiddenLiteral) || src.includes(forbiddenLiteralDq)).toBe(false);
    }
  });
});
