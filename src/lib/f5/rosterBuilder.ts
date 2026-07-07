/**
 * F5 · Layer 2 · roster builder.
 *
 * Daniel-approved 2026-07-04:
 *   - If YouTube batch-lookup returns < 5 matches, append top-20
 *     most-active inbox contacts (by sent-count) until roster has 20
 *     total.
 *   - If 0 YouTube matches, roster is 100% fallback contacts.
 *   - Roster UI clearly labels each row's source (`YouTube · 19.8M
 *     subs` vs `Active contact · you email weekly`).
 *
 * This module is the PURE FN that gates the fallback branches. Tests
 * exercise it at YT-match counts 0, 3, 8 to prove all three
 * behavioural regimes.
 */

import type { RawContact } from './contactScan';
import type { YouTubeMatch } from './youtubeCrossRef';

export interface RosterRow {
  email: string;
  displayName: string | null;
  source: 'youtube' | 'fallback';
  /** UI-facing label. Example: "YouTube · 19.8M subs" or
   *  "Active contact · you email weekly". */
  sourceLabel: string;
  ytChannelId: string | null;
  ytHandle: string | null;
  ytSubCount: number | null;
  sentCount: number;
}

export const ROSTER_TARGET_SIZE = 20;
export const YT_MATCH_FLOOR = 5;

export interface BuildRosterArgs {
  contacts: readonly RawContact[];
  matches: readonly YouTubeMatch[];
  targetSize?: number;
}

/**
 * Returns exactly targetSize (default 20) rows, prioritising YouTube
 * matches, then filling with the most-active inbox contacts. Rows are
 * labelled clearly so the UI can render each source distinctly.
 */
export function buildRoster(args: BuildRosterArgs): RosterRow[] {
  const targetSize = args.targetSize ?? ROSTER_TARGET_SIZE;
  const rows: RosterRow[] = [];

  const contactByEmail = new Map<string, RawContact>();
  for (const c of args.contacts) contactByEmail.set(c.email, c);

  // ── YouTube matches first (up to targetSize) ────────────────────
  const usedEmails = new Set<string>();
  for (const m of args.matches) {
    const contact = findContactByDomain(contactByEmail, m.domain);
    if (!contact) continue;
    if (usedEmails.has(contact.email)) continue;
    usedEmails.add(contact.email);
    rows.push({
      email: contact.email,
      displayName: contact.displayName,
      source: 'youtube',
      sourceLabel: `YouTube · ${formatSubs(m.sub_count)} subs`,
      ytChannelId: m.channel_id,
      ytHandle: m.handle,
      ytSubCount: m.sub_count,
      sentCount: contact.sentCount,
    });
    if (rows.length >= targetSize) break;
  }

  // ── Fallback branch ────────────────────────────────────────────
  // Fire when YT matches < YT_MATCH_FLOOR (i.e. 0-4 matches). Fill from
  // top-N most-active-inbox contacts.
  const needFallback = args.matches.length < YT_MATCH_FLOOR;
  if (needFallback && rows.length < targetSize) {
    const remaining = args.contacts
      .filter((c) => !usedEmails.has(c.email))
      .slice()
      .sort((a, b) => b.sentCount - a.sentCount);
    for (const c of remaining) {
      if (rows.length >= targetSize) break;
      rows.push({
        email: c.email,
        displayName: c.displayName,
        source: 'fallback',
        sourceLabel: fallbackLabel(c.sentCount),
        ytChannelId: null,
        ytHandle: null,
        ytSubCount: null,
        sentCount: c.sentCount,
      });
      usedEmails.add(c.email);
    }
  }

  return rows;
}

function findContactByDomain(
  contactByEmail: Map<string, RawContact>,
  domain: string,
): RawContact | null {
  for (const c of contactByEmail.values()) {
    if (c.email.endsWith('@' + domain)) return c;
  }
  return null;
}

export function formatSubs(subs: number): string {
  if (subs >= 1_000_000) return `${(subs / 1_000_000).toFixed(subs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (subs >= 1_000) return `${(subs / 1_000).toFixed(0)}K`;
  return String(subs);
}

export function fallbackLabel(sentCount: number): string {
  if (sentCount >= 10) return 'Active contact · you email daily';
  if (sentCount >= 4) return 'Active contact · you email weekly';
  if (sentCount >= 1) return 'Active contact · in your address book';
  return 'Contact · in your address book';
}
