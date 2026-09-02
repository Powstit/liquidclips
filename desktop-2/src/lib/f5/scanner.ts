/**
 * F5 · Layer 2 · top-level scanner state machine.
 *
 * States (per F5 spec):
 *   idle → oauth → scanning → crossref → ready
 *                       ↓          ↓
 *                     error      error
 *          ↓
 *        denied  (user clicked Deny on Google consent)
 *
 * The state machine is a pure class so tests can inject a mock OAuth
 * driver + mock HTTP fetch + mock YouTube batchLookup and walk every
 * branch without touching real Google endpoints.
 */

import { runOAuth, type OAuthDeps, type OAuthTokens } from './googleOAuth';
import { scanContacts, extractDomain, type HttpFetch, type RawContact, type ScanSource, type GoogleErrorDetail } from './contactScan';
import { buildRoster, YT_MATCH_FLOOR, type RosterRow } from './rosterBuilder';
import type { BatchLookup } from './youtubeCrossRef';

export type ScanState =
  | 'idle'
  | 'oauth'
  | 'scanning'
  | 'crossref'
  | 'ready'
  | 'error'
  | 'denied'
  | 'misconfigured';

export interface ScanProgress {
  state: ScanState;
  message: string;
  data?: {
    contacts?: number;
    domains?: number;
    ytMatches?: number;
    rosterSize?: number;
  };
  error?: string;
}

export interface ScannerDeps {
  oauth: OAuthDeps;
  httpFetch: HttpFetch;
  batchLookup: BatchLookup;
  minSubs?: number;
  onProgress?: (progress: ScanProgress) => void;
}

const DEFAULT_MIN_SUBS = 25_000;

export interface ScanOutcome {
  ok: boolean;
  finalState: ScanState;
  roster: RosterRow[];
  contacts: RawContact[];
  matchCount: number;
  errorMessage: string | null;
  transitions: Array<{ state: ScanState; at: number }>;
  /** Bucket 2.6 incident (2026-09-02) · non-secret diagnostic detail for
   *  a contact-scan failure ONLY — which Google endpoint failed + the
   *  safe subset of Google's error JSON. Never contains tokens or
   *  contact/email content. For telemetry, never for on-screen display —
   *  callers must keep using `errorMessage`/friendly-mapping for the UI. */
  diagnostic?: { source?: ScanSource; googleError?: GoogleErrorDetail };
}

export class F5Scanner {
  private deps: ScannerDeps;
  private transitions: Array<{ state: ScanState; at: number }> = [];

  constructor(deps: ScannerDeps) {
    this.deps = deps;
  }

  async run(now: () => number = Date.now): Promise<ScanOutcome> {
    this.recordTransition('idle', now());
    this.emit({ state: 'idle', message: 'ready to scan' });

    // ── OAuth ─────────────────────────────────────────────────────
    this.recordTransition('oauth', now());
    this.emit({ state: 'oauth', message: 'requesting Google consent' });
    const oauthResult = await runOAuth(this.deps.oauth);
    if (!oauthResult.ok) {
      if (oauthResult.error === 'DENIED') {
        this.recordTransition('denied', now());
        this.emit({ state: 'denied', message: 'user denied Google consent', error: oauthResult.note });
        return this.done('denied', [], [], 0, oauthResult.note ?? 'user denied consent');
      }
      if (oauthResult.error === 'MISCONFIGURED') {
        this.recordTransition('misconfigured', now());
        this.emit({ state: 'misconfigured', message: 'Google OAuth not yet configured', error: oauthResult.note });
        return this.done('misconfigured', [], [], 0, oauthResult.note ?? 'oauth misconfigured');
      }
      this.recordTransition('error', now());
      this.emit({ state: 'error', message: `oauth failed · ${oauthResult.error}`, error: oauthResult.note });
      return this.done('error', [], [], 0, oauthResult.note ?? `oauth ${oauthResult.error}`);
    }
    const tokens: OAuthTokens = oauthResult.tokens;

    // ── Contact scan ──────────────────────────────────────────────
    this.recordTransition('scanning', now());
    this.emit({ state: 'scanning', message: 'fetching contacts + sent-box' });
    const scanResult = await scanContacts({
      fetch: this.deps.httpFetch,
      accessToken: tokens.access,
    });
    if (!scanResult.ok) {
      this.recordTransition('error', now());
      this.emit({ state: 'error', message: `contact scan failed · ${scanResult.error}`, error: scanResult.note });
      return this.done('error', [], [], 0, scanResult.note ?? scanResult.error, {
        source: scanResult.source,
        googleError: scanResult.googleError,
      });
    }
    const contacts = scanResult.contacts;
    this.emit({
      state: 'scanning',
      message: `contacts fetched`,
      data: { contacts: contacts.length },
    });

    // ── YouTube cross-reference ───────────────────────────────────
    this.recordTransition('crossref', now());
    const domains = uniqueDomains(contacts);
    this.emit({
      state: 'crossref',
      message: `cross-referencing YouTube`,
      data: { contacts: contacts.length, domains: domains.length },
    });
    let matches;
    try {
      matches = await this.deps.batchLookup({
        domains,
        min_subs: this.deps.minSubs ?? DEFAULT_MIN_SUBS,
      });
    } catch (e) {
      this.recordTransition('error', now());
      this.emit({ state: 'error', message: 'YouTube worker failed', error: String(e).slice(0, 400) });
      return this.done('error', [], contacts, 0, `yt batch lookup: ${e}`);
    }

    // ── Roster build ──────────────────────────────────────────────
    const roster = buildRoster({ contacts, matches });
    this.recordTransition('ready', now());
    this.emit({
      state: 'ready',
      message: `roster built · ${roster.length} contacts (${matches.length} YT match${matches.length === 1 ? '' : 'es'})`,
      data: {
        contacts: contacts.length,
        domains: domains.length,
        ytMatches: matches.length,
        rosterSize: roster.length,
      },
    });
    return {
      ok: true,
      finalState: 'ready',
      roster,
      contacts,
      matchCount: matches.length,
      errorMessage: null,
      transitions: this.transitions,
    };
  }

  private recordTransition(state: ScanState, at: number): void {
    this.transitions.push({ state, at });
  }

  private emit(progress: ScanProgress): void {
    this.deps.onProgress?.(progress);
  }

  private done(
    finalState: ScanState,
    roster: RosterRow[],
    contacts: RawContact[],
    matchCount: number,
    errorMessage: string,
    diagnostic?: ScanOutcome['diagnostic'],
  ): ScanOutcome {
    return {
      ok: false,
      finalState,
      roster,
      contacts,
      matchCount,
      errorMessage,
      transitions: this.transitions,
      diagnostic,
    };
  }
}

function uniqueDomains(contacts: readonly RawContact[]): string[] {
  const set = new Set<string>();
  for (const c of contacts) {
    const d = extractDomain(c.email);
    if (d) set.add(d);
  }
  return [...set];
}

export { YT_MATCH_FLOOR };
