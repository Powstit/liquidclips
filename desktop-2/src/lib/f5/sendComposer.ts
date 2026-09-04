/**
 * F5 Scanner "Send" · mailto: composer builder.
 *
 * CM-T10 · 2026-07-05 walk-around wire.
 *
 * F5's OAuth scopes are read-only (`gmail.metadata` + `contacts.readonly`
 * — 2026-09-02, was `gmail.readonly`, see f5/contactScan.ts), so the app
 * cannot send email on the user's behalf regardless. Instead we open the
 * user's default mail client with a pre-filled warm-peer draft per contact.
 * The user hits Send inside their own signed-in Gmail / Apple Mail. Real
 * emails go out from their own account, no LC backend rail needed.
 *
 * This module is pure — no Tauri imports, no bus emits — so it can be
 * unit-tested with vitest without a live app shell.
 */

import type { RosterRow } from './rosterBuilder';
import { renderWarmPeer } from '../gmail/broadcastTemplate';

/** Fallback used when the sender has not yet minted a handle-based
 *  referral URL. Generic landing page still attributes if a Whop
 *  affiliate cookie is set post-click. */
export const FALLBACK_REFERRAL_URL = 'https://liquidclips.app/refer';

/**
 * Convert an HTML-fragment body (renderWarmPeer emits `<br>` joiners)
 * into a plaintext form suitable for a `mailto:` body param. Some mail
 * clients (Apple Mail, older Gmail composer) render literal HTML in
 * the body window; plaintext newlines are the safe path.
 */
export function stripHtmlToPlainText(html: string): string {
  return html
    // convert both self-closing and open <br> variants
    .replace(/<br\s*\/?>/gi, '\n')
    // strip any residual tags we don't want to leak
    .replace(/<[^>]+>/g, '');
}

/**
 * Best-effort first name from a roster row's displayName.
 * Falls back to 'friend' so the greeting always reads naturally.
 */
export function firstNameFromRow(row: RosterRow): string {
  const dn = (row.displayName ?? '').trim();
  if (!dn) return 'friend';
  const first = dn.split(/\s+/, 1)[0];
  return first || 'friend';
}

/**
 * Personalized preview URL for the warm-peer body.
 * Threads the sender's own referral URL, adding a `?prefill` hint
 * so the landing page can highlight the recipient's channel.
 */
export function previewUrlForRow(row: RosterRow, referralUrl: string): string {
  const hint = row.ytHandle || row.ytChannelId || '';
  if (!hint) return referralUrl;
  const sep = referralUrl.includes('?') ? '&' : '?';
  return `${referralUrl}${sep}prefill=${encodeURIComponent(hint)}`;
}

export interface BuildMailtoArgs {
  row: RosterRow;
  senderFirstName: string;
  referralUrl: string;
}

/**
 * Assemble the full `mailto:` URL for one roster row.
 * Uses `renderWarmPeer` for the locked subject + body, converts the
 * body to plaintext, and URL-encodes all three fields.
 */
export function buildMailtoUrl(args: BuildMailtoArgs): string {
  const { row, senderFirstName, referralUrl } = args;
  const previewUrl = previewUrlForRow(row, referralUrl);
  const rendered = renderWarmPeer(
    { email: row.email, firstName: firstNameFromRow(row), previewUrl },
    { senderFirstName },
  );
  const bodyPlain = stripHtmlToPlainText(rendered.body);
  // 2026-09-03 · bug found reviewing the OAuth demo recording: mailto:
  // query components need RFC 3986 percent-encoding (spaces = %20).
  // URLSearchParams produces application/x-www-form-urlencoded output
  // instead (spaces = `+`), which mail clients don't decode back to a
  // space in a mailto body/subject — every draft rendered with literal
  // `+` characters ("Hey+friend,"). encodeURIComponent is the correct,
  // mailto-safe encoder.
  const subject = encodeURIComponent(rendered.subject);
  const body = encodeURIComponent(bodyPlain);
  return `mailto:${encodeURIComponent(rendered.to)}?subject=${subject}&body=${body}`;
}

/** Cap per-Send-click so the user isn't buried under 20 Mail drafts. */
export const SEND_BATCH_CAP = 8;

/** Stagger between openSmart() calls · empirically macOS Mail chokes
 *  when N drafts arrive in the same tick; 250ms lets it queue cleanly. */
export const SEND_STAGGER_MS = 250;

/**
 * Pick the top-priority rows to open drafts for. YouTube-source rows
 * win over fallback rows (they're the higher-signal warm peers).
 * Falls through to the roster's natural order after that.
 */
export function selectSendBatch(
  rows: readonly RosterRow[],
  selectedEmails: ReadonlySet<string>,
  cap: number = SEND_BATCH_CAP,
): RosterRow[] {
  const selected = rows.filter((r) => selectedEmails.has(r.email));
  const yt = selected.filter((r) => r.source === 'youtube');
  const fallback = selected.filter((r) => r.source === 'fallback');
  return [...yt, ...fallback].slice(0, cap);
}
