/**
 * F5 · realDrivers · production driver tests.
 *
 * Covers:
 *   * productionOAuthDriver returns MISCONFIGURED when no clientId
 *   * productionBatchLookup returns [] when only bare domains supplied
 *     (proves the "honest empty state, no fabricated matches" guarantee)
 *   * File-source guard: the source imports NEVER include demo drivers
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { productionOAuthDriver, productionBatchLookup } from './realDrivers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('F5 · realDrivers', () => {
  it('productionOAuthDriver returns MISCONFIGURED when clientId is empty', async () => {
    const result = await productionOAuthDriver({ clientId: '', scopes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('MISCONFIGURED');
    }
  });

  it('productionBatchLookup returns [] when no channel_ids are extracted (honest empty)', async () => {
    // Bare email-domain style tokens are not YouTube channel IDs. We
    // do NOT invent matches — the F5 rosterBuilder handles fallback
    // by sorting inbox contacts by sent-count.
    const matches = await productionBatchLookup({
      domains: ['example.com', 'friend.io', 'clipper.tv'],
      min_subs: 25_000,
    });
    expect(Array.isArray(matches)).toBe(true);
    expect(matches).toHaveLength(0);
  });

  it('source file does NOT import demo drivers', () => {
    const src = readFileSync(resolve(__dirname, 'realDrivers.ts'), 'utf-8');
    // Prevent regression: prod drivers must never sneak in a demo
    // fallback import.
    expect(src).not.toContain('demoOAuthDriver');
    expect(src).not.toContain('demoHttpFetch');
    expect(src).not.toContain('demoBatchLookup');
    expect(src).toContain('openSmart');
    expect(src).toContain('awaitGoogleOAuth');
  });
});
