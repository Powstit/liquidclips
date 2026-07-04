/**
 * F5 · Layer 2 · scanner + roster + OAuth unit tests.
 *
 * Covers Daniel's updated proof list:
 *   - F5 unit tests: contact fetch mock · 3 fallback branches (YT
 *     match counts 0, 3, 8) · OAuth denied · rate limit
 *   - Mock OAuth roundtrip · verify token handling + scope + denied
 *
 * No real Google endpoints hit — every dep is injected.
 */

import { describe, it, expect } from 'vitest';
import { F5Scanner, YT_MATCH_FLOOR } from './scanner';
import { buildRoster } from './rosterBuilder';
import type { RawContact } from './contactScan';
import type { YouTubeMatch } from './youtubeCrossRef';
import type { HttpFetch } from './contactScan';
import type { OAuthDriver } from './googleOAuth';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mkContact(email: string, sentCount = 0, displayName: string | null = null): RawContact {
  return { email, displayName, sentCount };
}

function mkYtMatch(domain: string, subs = 100_000): YouTubeMatch {
  return {
    domain,
    channel_id: `ch_${domain.replace(/[^a-z0-9]/g, '')}`,
    handle: `@${domain.split('.')[0]}`,
    avatar_url: `https://yt3.googleusercontent.com/${domain}.jpg`,
    sub_count: subs,
    latest_10_videos: [],
  };
}

/** Mock HTTP fetch that returns pre-canned Google API responses. */
function mkMockFetch(opts: {
  connectionsStatus?: number;
  connectionsBody?: unknown;
  sentStatus?: number;
  sentBody?: unknown;
} = {}): HttpFetch {
  return async ({ url }) => {
    if (url.includes('people.googleapis.com')) {
      return {
        status: opts.connectionsStatus ?? 200,
        body: opts.connectionsBody ?? {
          connections: [
            { names: [{ displayName: 'Kate' }], emailAddresses: [{ value: 'kate@youtube.com' }] },
            { names: [{ displayName: 'Marques' }], emailAddresses: [{ value: 'marques@mkbhd.com' }] },
            { names: [{ displayName: 'Alex' }], emailAddresses: [{ value: 'alex@daily-podcast.com' }] },
          ],
        },
      };
    }
    if (url.includes('gmail.googleapis.com')) {
      return {
        status: opts.sentStatus ?? 200,
        body: opts.sentBody ?? {
          sent: [
            { to: 'alex@daily-podcast.com' },
            { to: 'alex@daily-podcast.com' },
            { to: 'daniel@newsletter.io' },
          ],
        },
      };
    }
    return { status: 404, body: {} };
  };
}

// ─────────────────────────────────────────────────────────────
// 1 · Contact fetch mock
// ─────────────────────────────────────────────────────────────

describe('F5 · contact fetch', () => {
  it('merges People API + sent-box into deduped contacts with sent counts', async () => {
    const oauthDriver: OAuthDriver = async () => ({
      ok: true,
      tokens: { access: 'AT', refresh: null, expiresAt: Date.now() + 3600_000, scope: [] as any },
    });
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: oauthDriver },
      httpFetch: mkMockFetch(),
      batchLookup: async () => [],
    }).run();
    // Contacts total = union of {kate, marques, alex} and {alex×2, daniel}
    expect(outcome.contacts.length).toBe(4);
    const alex = outcome.contacts.find((c) => c.email === 'alex@daily-podcast.com');
    expect(alex).toBeDefined();
    expect(alex!.sentCount).toBe(2);
    const daniel = outcome.contacts.find((c) => c.email === 'daniel@newsletter.io');
    expect(daniel).toBeDefined();
    expect(daniel!.sentCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 2 · Three fallback branches (0, 3, 8 YT matches)
// ─────────────────────────────────────────────────────────────

describe('F5 · fallback roster (0 · 3 · 8 YT match branches)', () => {
  // Build a synthetic pool of 30 contacts with varied sent counts so the
  // top-20-by-sent-count fallback has something to sort.
  function poolOf30(): RawContact[] {
    return Array.from({ length: 30 }, (_, i) => mkContact(
      `contact${i}@example.com`,
      30 - i,           // contact0 has 30 sends, contact29 has 1
    ));
  }

  it('0 YT matches → roster is 100% fallback contacts, size 20', () => {
    const contacts = poolOf30();
    const matches: YouTubeMatch[] = [];
    const roster = buildRoster({ contacts, matches });
    expect(roster.length).toBe(20);
    expect(roster.every((r) => r.source === 'fallback')).toBe(true);
    // Sorted by sentCount desc
    for (let i = 0; i < roster.length - 1; i++) {
      expect(roster[i].sentCount).toBeGreaterThanOrEqual(roster[i + 1].sentCount);
    }
  });

  it('3 YT matches → 3 YouTube rows + 17 fallback rows (<5 floor triggers fallback)', () => {
    expect(YT_MATCH_FLOOR).toBe(5);
    // Contacts include 3 matchable YouTube domains + 20 non-YT contacts
    const ytContacts: RawContact[] = [
      mkContact('a@channel-a.com', 5, 'A'),
      mkContact('b@channel-b.com', 4, 'B'),
      mkContact('c@channel-c.com', 3, 'C'),
    ];
    const rest = Array.from({ length: 20 }, (_, i) => mkContact(`filler${i}@example.com`, 20 - i));
    const contacts = [...ytContacts, ...rest];
    const matches: YouTubeMatch[] = [
      mkYtMatch('channel-a.com', 1_200_000),
      mkYtMatch('channel-b.com', 300_000),
      mkYtMatch('channel-c.com', 80_000),
    ];
    const roster = buildRoster({ contacts, matches });
    expect(roster.length).toBe(20);
    const yt = roster.filter((r) => r.source === 'youtube');
    const fallback = roster.filter((r) => r.source === 'fallback');
    expect(yt.length).toBe(3);
    expect(fallback.length).toBe(17);
    // YT labels are formed correctly
    expect(yt[0].sourceLabel).toContain('YouTube');
    expect(yt[0].sourceLabel).toContain('1.2M subs');
    // Fallback labels reflect sent counts
    expect(fallback[0].sourceLabel).toContain('Active contact');
  });

  it('8 YT matches → 8 YouTube rows only, NO fallback (>=5 floor NOT triggered)', () => {
    const ytContacts = Array.from({ length: 8 }, (_, i) =>
      mkContact(`x${i}@ytch${i}.com`, 3, `X${i}`),
    );
    const rest = Array.from({ length: 20 }, (_, i) => mkContact(`filler${i}@example.com`, 20 - i));
    const contacts = [...ytContacts, ...rest];
    const matches = Array.from({ length: 8 }, (_, i) => mkYtMatch(`ytch${i}.com`, 500_000 + i * 100_000));
    const roster = buildRoster({ contacts, matches });
    // 8 YT + no fallback (matches >= 5, no filler injected)
    expect(roster.length).toBe(8);
    expect(roster.every((r) => r.source === 'youtube')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 3 · OAuth denied surface
// ─────────────────────────────────────────────────────────────

describe('F5 · OAuth', () => {
  it('user-denied path transitions to `denied` state and returns no roster', async () => {
    const deniedDriver: OAuthDriver = async () => ({
      ok: false,
      error: 'DENIED',
      note: 'user clicked Deny',
    });
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: deniedDriver },
      httpFetch: mkMockFetch(),
      batchLookup: async () => [],
    }).run();
    expect(outcome.ok).toBe(false);
    expect(outcome.finalState).toBe('denied');
    expect(outcome.roster.length).toBe(0);
    expect(outcome.errorMessage).toContain('Deny');
  });

  it('missing client_id → `misconfigured` state (TODO(daniel-provide-client-id))', async () => {
    const driver: OAuthDriver = async () => {
      throw new Error('should never be called when client_id is missing');
    };
    const outcome = await new F5Scanner({
      oauth: { clientId: undefined, driver },
      httpFetch: mkMockFetch(),
      batchLookup: async () => [],
    }).run();
    expect(outcome.ok).toBe(false);
    expect(outcome.finalState).toBe('misconfigured');
    expect(outcome.errorMessage).toContain('GOOGLE_OAUTH_CLIENT_ID');
  });

  it('successful roundtrip carries scope + expiresAt through to scanner', async () => {
    let receivedScopes: readonly string[] = [];
    const successDriver: OAuthDriver = async ({ scopes }) => {
      receivedScopes = scopes;
      return {
        ok: true,
        tokens: {
          access: 'access-token-abc',
          refresh: 'refresh-token-xyz',
          expiresAt: Date.now() + 3600_000,
          scope: scopes,
        },
      };
    };
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: successDriver },
      httpFetch: mkMockFetch(),
      batchLookup: async () => [],
    }).run();
    expect(outcome.finalState).toBe('ready');
    expect(receivedScopes).toContain('https://www.googleapis.com/auth/contacts.readonly');
    expect(receivedScopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
  });
});

// ─────────────────────────────────────────────────────────────
// 4 · Rate limit / exponential backoff
// ─────────────────────────────────────────────────────────────

describe('F5 · rate limit', () => {
  it('surfaces RATE_LIMITED after retries exhaust on 429', async () => {
    let calls = 0;
    const rateLimitFetch: HttpFetch = async () => {
      calls++;
      return { status: 429, body: {} };
    };
    const oauthDriver: OAuthDriver = async () => ({
      ok: true,
      tokens: { access: 'AT', refresh: null, expiresAt: Date.now() + 3600_000, scope: [] as any },
    });
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: oauthDriver },
      httpFetch: rateLimitFetch,
      batchLookup: async () => [],
    }).run();
    expect(outcome.ok).toBe(false);
    expect(outcome.finalState).toBe('error');
    expect(outcome.errorMessage).toContain('429');
    // 3 retries · both connections + sent-box fetch fire in parallel · so at
    // least 4 calls per endpoint (initial + 3 retries).
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it('recovers when a transient 500 clears on retry', async () => {
    let calls = 0;
    const flakyFetch: HttpFetch = async ({ url }) => {
      calls++;
      if (calls === 1 && url.includes('people.googleapis.com')) {
        return { status: 500, body: { error: 'transient' } };
      }
      if (url.includes('people.googleapis.com')) {
        return { status: 200, body: { connections: [] } };
      }
      return { status: 200, body: { sent: [] } };
    };
    const oauthDriver: OAuthDriver = async () => ({
      ok: true,
      tokens: { access: 'AT', refresh: null, expiresAt: Date.now() + 3600_000, scope: [] as any },
    });
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: oauthDriver },
      httpFetch: flakyFetch,
      batchLookup: async () => [],
      onProgress: () => undefined,
    }).run();
    expect(outcome.finalState).toBe('ready');
    expect(outcome.contacts.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 5 · State-machine transitions record for the receipt diagram
// ─────────────────────────────────────────────────────────────

describe('F5 · state machine', () => {
  it('records the expected transition sequence for a happy-path run', async () => {
    const oauthDriver: OAuthDriver = async () => ({
      ok: true,
      tokens: { access: 'AT', refresh: null, expiresAt: Date.now() + 3600_000, scope: [] as any },
    });
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: oauthDriver },
      httpFetch: mkMockFetch(),
      batchLookup: async () => [],
    }).run();
    const states = outcome.transitions.map((t) => t.state);
    expect(states).toEqual(['idle', 'oauth', 'scanning', 'crossref', 'ready']);
  });

  it('records the expected transition sequence for the denied path', async () => {
    const oauthDriver: OAuthDriver = async () => ({ ok: false, error: 'DENIED', note: 'nope' });
    const outcome = await new F5Scanner({
      oauth: { clientId: 'test-client', driver: oauthDriver },
      httpFetch: mkMockFetch(),
      batchLookup: async () => [],
    }).run();
    const states = outcome.transitions.map((t) => t.state);
    expect(states).toEqual(['idle', 'oauth', 'denied']);
  });
});
