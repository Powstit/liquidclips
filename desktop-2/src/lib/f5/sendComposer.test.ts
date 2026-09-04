/**
 * CM-T10 · sendComposer unit tests.
 *
 * Verifies the mailto:URL builder, HTML→plaintext converter, first-name
 * extraction, per-row preview URL threading, and batch selection.
 */

import { describe, it, expect } from 'vitest';
import type { RosterRow } from './rosterBuilder';
import {
  FALLBACK_REFERRAL_URL,
  SEND_BATCH_CAP,
  buildMailtoUrl,
  firstNameFromRow,
  previewUrlForRow,
  selectSendBatch,
  stripHtmlToPlainText,
} from './sendComposer';

function makeRow(overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    email: 'jane@example.com',
    displayName: 'Jane Doe',
    source: 'youtube',
    sourceLabel: 'YouTube · 19.8M subs',
    ytChannelId: 'UCabc123',
    ytHandle: '@janedoe',
    ytSubCount: 19_800_000,
    sentCount: 5,
    ...overrides,
  };
}

describe('stripHtmlToPlainText', () => {
  it('converts <br> to newline', () => {
    expect(stripHtmlToPlainText('a<br>b<br />c<br/>d')).toBe('a\nb\nc\nd');
  });

  it('strips leftover tags', () => {
    expect(stripHtmlToPlainText('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
  });

  it('passes through plain text', () => {
    expect(stripHtmlToPlainText('no tags here')).toBe('no tags here');
  });

  it('handles the real renderWarmPeer body shape', () => {
    const body = 'Hey Jane,<br><br>line 2<br>line 3';
    expect(stripHtmlToPlainText(body)).toBe('Hey Jane,\n\nline 2\nline 3');
  });
});

describe('firstNameFromRow', () => {
  it('returns first token of displayName', () => {
    expect(firstNameFromRow(makeRow({ displayName: 'Jane Doe' }))).toBe('Jane');
  });

  it('falls back when displayName is null', () => {
    expect(firstNameFromRow(makeRow({ displayName: null }))).toBe('friend');
  });

  it('falls back when displayName is whitespace', () => {
    expect(firstNameFromRow(makeRow({ displayName: '   ' }))).toBe('friend');
  });

  it('handles single-name displayName', () => {
    expect(firstNameFromRow(makeRow({ displayName: 'Cher' }))).toBe('Cher');
  });
});

describe('previewUrlForRow', () => {
  it('appends prefill when ytHandle is present', () => {
    const url = previewUrlForRow(makeRow({ ytHandle: '@janedoe' }), 'https://liquidclips.app/refer/dan');
    expect(url).toBe('https://liquidclips.app/refer/dan?prefill=%40janedoe');
  });

  it('appends prefill when only channelId is present', () => {
    const url = previewUrlForRow(
      makeRow({ ytHandle: null, ytChannelId: 'UCabc123' }),
      'https://liquidclips.app/refer/dan',
    );
    expect(url).toBe('https://liquidclips.app/refer/dan?prefill=UCabc123');
  });

  it('returns bare referral URL when no YT hints', () => {
    const url = previewUrlForRow(
      makeRow({ ytHandle: null, ytChannelId: null }),
      'https://liquidclips.app/refer/dan',
    );
    expect(url).toBe('https://liquidclips.app/refer/dan');
  });

  it('uses & separator when referral URL already has a query', () => {
    const url = previewUrlForRow(
      makeRow({ ytHandle: '@janedoe' }),
      'https://liquidclips.app/refer?src=warm',
    );
    expect(url).toBe('https://liquidclips.app/refer?src=warm&prefill=%40janedoe');
  });
});

describe('buildMailtoUrl', () => {
  const referralUrl = 'https://liquidclips.app/refer/dan';

  it('builds a full mailto with encoded subject + body + to', () => {
    const url = buildMailtoUrl({ row: makeRow(), senderFirstName: 'Daniel', referralUrl });
    expect(url.startsWith('mailto:jane%40example.com?')).toBe(true);
    expect(url).toContain('subject=');
    expect(url).toContain('body=');
  });

  it('embeds the sender name in the body', () => {
    const url = buildMailtoUrl({
      row: makeRow(),
      senderFirstName: 'Danielxxx',
      referralUrl,
    });
    const decoded = decodeURIComponent(url.split('body=')[1] ?? '');
    expect(decoded).toContain('Danielxxx');
  });

  it('embeds recipient first name in the body', () => {
    const url = buildMailtoUrl({
      row: makeRow({ displayName: 'Marcus Byrne' }),
      senderFirstName: 'Daniel',
      referralUrl,
    });
    const decoded = decodeURIComponent(url.split('body=')[1] ?? '');
    expect(decoded).toContain('Hey Marcus,');
  });

  it('embeds the personalized preview URL in the body', () => {
    const url = buildMailtoUrl({
      row: makeRow({ ytHandle: '@marcusb' }),
      senderFirstName: 'Daniel',
      referralUrl,
    });
    const decoded = decodeURIComponent(url.split('body=')[1] ?? '');
    expect(decoded).toContain('liquidclips.app/refer/dan?prefill=%40marcusb');
  });

  it('uses the fallback referral URL when none supplied', () => {
    const url = buildMailtoUrl({
      row: makeRow({ ytHandle: null, ytChannelId: null }),
      senderFirstName: 'Daniel',
      referralUrl: FALLBACK_REFERRAL_URL,
    });
    const decoded = decodeURIComponent(url.split('body=')[1] ?? '');
    expect(decoded).toContain(FALLBACK_REFERRAL_URL);
  });

  it('percent-encodes spaces in the subject (mailto: needs %20, not +)', () => {
    const url = buildMailtoUrl({ row: makeRow(), senderFirstName: 'Daniel', referralUrl });
    // Subject contains "I ran your channel through Liquid Clips". mailto:
    // query components are RFC 3986, not application/x-www-form-urlencoded
    // — a literal `+` in a mailto body/subject is not decoded back to a
    // space by mail clients, so it must never appear here.
    expect(url).toMatch(/subject=I%20ran%20your%20channel/);
    expect(url).not.toContain('+');
  });
});

describe('selectSendBatch', () => {
  const rows: RosterRow[] = [
    makeRow({ email: 'a@example.com', source: 'youtube' }),
    makeRow({ email: 'b@example.com', source: 'fallback' }),
    makeRow({ email: 'c@example.com', source: 'youtube' }),
    makeRow({ email: 'd@example.com', source: 'fallback' }),
  ];

  it('respects the selection set', () => {
    const batch = selectSendBatch(rows, new Set(['a@example.com', 'c@example.com']));
    expect(batch.map((r) => r.email)).toEqual(['a@example.com', 'c@example.com']);
  });

  it('prioritizes YouTube rows over fallback rows', () => {
    const batch = selectSendBatch(
      rows,
      new Set(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']),
    );
    expect(batch.map((r) => r.source)).toEqual(['youtube', 'youtube', 'fallback', 'fallback']);
  });

  it('caps at SEND_BATCH_CAP by default', () => {
    const big = Array.from({ length: 20 }, (_, i) =>
      makeRow({ email: `u${i}@example.com`, source: 'youtube' }),
    );
    const all = new Set(big.map((r) => r.email));
    expect(selectSendBatch(big, all).length).toBe(SEND_BATCH_CAP);
  });

  it('accepts a custom cap', () => {
    const batch = selectSendBatch(
      rows,
      new Set(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']),
      2,
    );
    expect(batch.length).toBe(2);
  });

  it('returns empty when nothing selected', () => {
    expect(selectSendBatch(rows, new Set())).toEqual([]);
  });
});
