/**
 * CrewOnboarding · post-verify Crew referral flywheel.
 *
 * Ships 2026-07-10 · Priority 1 crew agent · P1 gate before Home.
 *
 * Customer journey:
 *   1. User creates/verifies their account.
 *   2. Immediately after verification they see the referral value and a
 *      PRIMARY "Choose a contact" action (native macOS Contacts).
 *   3a. NATIVE (primary): pick ONE contact → shared `useNativeContactInvite`
 *       runs the existing-user K-factor gate (POST /me/contact-check) →
 *       non-user → POST /me/crew/match for the per-contact 50% figure →
 *       `native-confirm` card → `onApproveSend` → POST /me/crew/invites/send.
 *       Existing user → dead-end. No email → manual-email fallback. Always
 *       a tracked server invite — never a raw mailto:/sms:.
 *   3b. GOOGLE (secondary, "Scan my whole network"): unchanged F5Scanner
 *       bulk path — OAuth → Gmail/Contacts scan → creator match → the big
 *       "$900/mo" reveal → per-row /me/crew/invites/send.
 *   4. Referral links + attribution attached by the backend (invite_id,
 *      /i/{invite_id}, ref code, activated_user_id, Whop payment → 50%).
 *   5. Wallet shows: Invited · Opened · Joined · Paying · commission.
 *
 * States:
 *   * `hook`               → value copy · PRIMARY "Choose a contact" +
 *                            secondary "Scan my whole network" + native
 *                            sub-states (checking / existing-user /
 *                            lookup-error / need-email)
 *   * `native-matching`    → POST /me/crew/match for the one picked contact
 *   * `native-confirm`     → single-contact confirm card before the invite
 *   * `connecting-google`  → OAuth in flight (OS browser)
 *   * `scanning`           → contact scan running
 *   * `finding-creators`   → YouTube cross-reference in flight
 *   * `calculating`        → hitting /me/crew/match
 *   * `reveal`             → MRR reveal + recipient review
 *   * `sending`            → firing /me/crew/invites/send per row
 *   * `results`            → success · commission preview · CTA to Wallet
 *   * `denied`             → user hit Deny on Google consent
 *   * `misconfigured`      → env vars absent (Daniel hasn't finished setup)
 *   * `empty`              → zero matches · honest state · no fake MRR
 *   * `error`              → other failure · retry
 *
 * MRR calculation (documented for the report):
 *   * Backend `/me/crew/match` sums `estimated_monthly_earnings_cents *
 *     AFFILIATE_RATE` across all matched cold_leads.
 *   * AFFILIATE_RATE = 0.50 (locked per pricing_pivot_2026-07-06).
 *   * `earning_potential_cents` is the user's 50% share — never inflated,
 *     never multiplied by a made-up user count.
 *   * `estimated_opportunity_cents` (the gap between what the lead
 *     currently earns and what they could earn cross-platform) is the
 *     loss-aversion pitch: "leaving $X/mo on the table".
 *   * Zero matches → honest empty state · no fabricated MRR.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { F5Scanner, type ScanState } from '../../lib/f5/scanner';
import {
  loadClientIdFromEnv,
  type OAuthDriver,
} from '../../lib/f5/googleOAuth';
import type { HttpFetch } from '../../lib/f5/contactScan';
import type { BatchLookup } from '../../lib/f5/youtubeCrossRef';
import { getJwt } from '../../lib/authStorage';
import { authedFetch } from '../../lib/authedFetch';
import { humanError } from '../../lib/humanError';
import {
  productionOAuthDriver,
  productionHttpFetch,
  productionBatchLookup,
} from '../../lib/f5/realDrivers';
// 2026-09-10 · native macOS Contacts becomes the PRIMARY referral path.
// Same pick → /me/contact-check → existing-user / email / no-email
// journey the Outreach money-drop surface already ships, hoisted into a
// shared hook. Google (F5Scanner above) stays as the optional
// "Scan my whole network" bulk path.
import {
  useNativeContactInvite,
  type NativeInviteEmailContact,
} from '../../lib/f5/useNativeContactInvite';
// Wave 1 · Cluster 1 · identity ladder (2026-07-12) · mount the
// first-run handle claim sheet AFTER the crew flow completes. See
// ``lcos/09_BUG_LEDGER.md`` BUG-003.
import { ClaimHandleSheet } from '../../design-os/onboarding/ClaimHandleSheet';
import { useMe } from '../../design-os/state/useMe';
import './CrewOnboarding.css';

// ─────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────

export type CrewPhase =
  | 'hook'
  // Native single-contact path (primary):
  | 'native-matching'   // POST /me/crew/match for the one picked contact
  | 'native-confirm'    // single-contact confirm card before the server invite
  // Google bulk-scan path (secondary, "Scan my whole network"):
  | 'connecting-google'
  | 'scanning'
  | 'finding-creators'
  | 'calculating'
  | 'reveal'
  // Shared tail:
  | 'sending'
  | 'results'
  | 'denied'
  | 'misconfigured'
  | 'empty'
  | 'error';

interface CrewMatchRow {
  email: string;
  handle: string;
  niche: string | null;
  audience_size: number | null;
  estimated_monthly_earnings_cents: number | null;
  estimated_opportunity_cents: number | null;
  earnings_low_cents: number | null;
  earnings_high_cents: number | null;
  absent_platforms: string | null;
  earnings_verified_by_owner: boolean;
  preview_clip_url: string | null;
  your_50pct_cents: number;
}

interface CrewMatchResponse {
  matched: CrewMatchRow[];
  not_matched_count: number;
  referrer_affiliate_code: string | null;
  referral_share_url: string;
  earning_potential_cents: number;
}

interface InviteSendResult {
  email: string;
  status: 'sent' | 'queued_no_email' | 'dedup' | 'failed';
  message?: string;
}

// ─────────────────────────────────────────────────────────────
// Props · DI for tests + prod
// ─────────────────────────────────────────────────────────────

export interface CrewOnboardingProps {
  /** Optional injected OAuth driver — production uses productionOAuthDriver. */
  oauthDriver?: OAuthDriver;
  httpFetch?: HttpFetch;
  batchLookup?: BatchLookup;
  /** Called when the user completes or dismisses. Router uses this to
   *  advance to Home. */
  onDone: () => void;
  /** Optional test seam — override the backend base URL. */
  backendBaseUrl?: string;
}

function envBackend(): string {
  try {
    const env = (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } })
      .env ?? {};
    return (env.VITE_BACKEND_URL ?? 'https://api.liquidclips.app').replace(/\/+$/, '');
  } catch {
    return 'https://api.liquidclips.app';
  }
}

function isDevBuild(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function CrewOnboarding(props: CrewOnboardingProps): React.ReactElement {
  const [phase, setPhase] = useState<CrewPhase>('hook');
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<CrewMatchResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendResults, setSendResults] = useState<InviteSendResult[]>([]);
  const shownMarkerFiredRef = useRef(false);
  // Wave 1 · BUG-003 (2026-07-12) · after the crew flow completes we
  // conditionally show the ClaimHandleSheet if the customer has no
  // handle yet. State: null (not showing) | true (showing) — the
  // ``useMe`` snapshot inside the sheet decides whether it renders
  // anything, so ``null`` is a hard un-mount even if the ladder
  // becomes claimable later (a subsequent Home visit re-evaluates
  // via a separate mount).
  const [handleSheetOpen, setHandleSheetOpen] = useState<boolean>(false);
  // 2026-09-10 · the one contact the user picked from native macOS
  // Contacts (primary path). Held so the `native-confirm` card + the
  // shared `onApproveSend` can address the server invite.
  const [nativeContact, setNativeContact] = useState<NativeInviteEmailContact | null>(null);
  const me = useMe();

  const backend = props.backendBaseUrl ?? envBackend();

  // ── Native path · one confirmed non-user contact → server invite ──
  // K-factor safety (existing-user check) + the pick / email / no-email
  // journey all live in `useNativeContactInvite`. When it hands us a
  // usable email we run the SAME /me/crew/match the Google path uses
  // (for the per-contact 50% figure), then land on the confirm card.
  // The tracked invite itself still goes through /me/crew/invites/send
  // via the shared `onApproveSend` — never a raw mailto:/sms:.
  const onNativeEmailContactReady = useCallback(
    async ({ displayName, email }: NativeInviteEmailContact) => {
      setError(null);
      setNativeContact({ displayName, email });
      const jwt = getJwt();
      if (!jwt) {
        setError('You need to sign in first · return to the login screen.');
        setPhase('error');
        return;
      }
      setPhase('native-matching');
      try {
        const matchRes = await authedFetch(`${backend}/me/crew/match`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emails: [email], handles: [] }),
        });
        let payload: CrewMatchResponse | null = null;
        let row: CrewMatchRow | null = null;
        if (matchRes.ok) {
          payload = (await matchRes.json()) as CrewMatchResponse;
          row =
            payload.matched.find(
              (m) => m.email.toLowerCase() === email.toLowerCase(),
            ) ?? payload.matched[0] ?? null;
        } else if (matchRes.status === 401) {
          setError('Sign in first · return to the login screen.');
          setPhase('error');
          return;
        }
        // Whether or not this person is a known cold-lead, the user
        // explicitly chose to invite them — always give them a tracked
        // server invite. Synthesize a minimal row when unmatched so the
        // shared reveal/confirm/send code needs no special-casing.
        const confirmRow: CrewMatchRow = row ?? {
          email,
          handle: '',
          niche: null,
          audience_size: null,
          estimated_monthly_earnings_cents: null,
          estimated_opportunity_cents: null,
          earnings_low_cents: null,
          earnings_high_cents: null,
          absent_platforms: null,
          earnings_verified_by_owner: false,
          preview_clip_url: null,
          your_50pct_cents: 0,
        };
        setMatchResult({
          matched: [confirmRow],
          not_matched_count: row ? 0 : 1,
          referrer_affiliate_code: payload?.referrer_affiliate_code ?? null,
          referral_share_url: payload?.referral_share_url ?? 'https://liquidclips.app/',
          earning_potential_cents: confirmRow.your_50pct_cents,
        });
        setSelected(new Set([email]));
        setPhase('native-confirm');
      } catch (e) {
        setError(humanError(e, "Couldn't check that contact right now · try again."));
        setPhase('error');
      }
    },
    [backend],
  );

  const nativeInvite = useNativeContactInvite({
    onEmailContactReady: onNativeEmailContactReady,
    // No `onMessagesChannelChosen` — onboarding always routes through the
    // tracked /me/crew/invites/send flow, so a phone-only contact falls
    // through to the manual-email fallback instead of an sms: hand-off.
  });

  const resetNativePath = useCallback(() => {
    nativeInvite.reset();
    setNativeContact(null);
    setMatchResult(null);
    setSelected(new Set());
    setError(null);
    setPhase('hook');
  }, [nativeInvite]);

  // Fire the `shown_at` marker once when the component mounts.
  useEffect(() => {
    if (shownMarkerFiredRef.current) return;
    shownMarkerFiredRef.current = true;
    const jwt = getJwt();
    if (!jwt) return;
    // L1 · 2026-07-11 · authedFetch handles the 401 case.
    void authedFetch(`${backend}/onboarding/crew/shown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  }, [backend]);

  // ── Connect Google & scan ─────────────────────────────────────
  const onConnect = useCallback(async () => {
    setError(null);
    setPhase('connecting-google');
    const isDev = isDevBuild();
    const driver = props.oauthDriver ?? productionOAuthDriver;
    const httpFetch = props.httpFetch ?? productionHttpFetch;
    const batchLookup = props.batchLookup ?? productionBatchLookup;
    const clientId = loadClientIdFromEnv();
    if (!clientId && !isDev) {
      setPhase('misconfigured');
      return;
    }
    const scanner = new F5Scanner({
      oauth: { clientId: clientId ?? 'demo-client', driver },
      httpFetch,
      batchLookup,
      onProgress: (p) => {
        if (p.state === 'scanning') setPhase('scanning');
        if (p.state === 'crossref') setPhase('finding-creators');
      },
    });
    try {
      const outcome = await scanner.run();
      if (!outcome.ok) {
        if (outcome.finalState === 'denied') {
          setPhase('denied');
          return;
        }
        if (outcome.finalState === 'misconfigured') {
          setPhase('misconfigured');
          return;
        }
        setError(outcome.errorMessage ?? outcome.finalState);
        setPhase('error');
        return;
      }
      // Cross-reference against our cold_leads pool via /me/crew/match.
      setPhase('calculating');
      const emails = outcome.roster.map((r) => r.email);
      const jwt = getJwt();
      if (!jwt) {
        setError('You need to sign in first · return to the login screen.');
        setPhase('error');
        return;
      }
      const matchRes = await authedFetch(`${backend}/me/crew/match`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emails, handles: [] }),
      });
      if (!matchRes.ok) {
        setError(
          matchRes.status === 401
            ? 'Sign in first · return to the login screen.'
            : "Couldn't match your crew right now · try again.",
        );
        setPhase('error');
        return;
      }
      const payload = (await matchRes.json()) as CrewMatchResponse;
      setMatchResult(payload);
      if (payload.matched.length === 0) {
        setPhase('empty');
        return;
      }
      // Preselect every match.
      setSelected(new Set(payload.matched.map((m) => m.email)));
      setPhase('reveal');
    } catch (e) {
      setError(humanError(e, "Couldn't match your crew right now · try again."));
      setPhase('error');
    }
  }, [props.oauthDriver, props.httpFetch, props.batchLookup, backend]);

  // 2026-09-10 · Google bulk-scan ("Scan my whole network") is HIDDEN
  // from onboarding for this iteration — its CTA is commented out in the
  // hook render below. `onConnect` + every Google-path phase stays fully
  // wired so it can be restored by un-commenting that button. Referenced
  // here so the dormant handler doesn't trip noUnusedLocals.
  void onConnect;

  // ── Send invitations · fires /me/crew/invites/send per selected row ──
  const onApproveSend = useCallback(async () => {
    if (!matchResult) return;
    const selectedRows = matchResult.matched.filter((r) => selected.has(r.email));
    if (selectedRows.length === 0) {
      setError('Select at least one contact to send.');
      return;
    }
    setError(null);
    setPhase('sending');
    setSendResults([]);
    const jwt = getJwt();
    if (!jwt) {
      setError('Sign in first · return to the login screen.');
      setPhase('error');
      return;
    }
    const results: InviteSendResult[] = [];
    for (const row of selectedRows) {
      try {
        const res = await authedFetch(`${backend}/me/crew/invites/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            recipient_email: row.email,
            recipient_handle: row.handle,
          }),
        });
        if (!res.ok) {
          results.push({
            email: row.email,
            status: 'failed',
            message: res.status === 401 ? 'sign in again' : 'send failed · try again',
          });
          continue;
        }
        const body = (await res.json()) as { email_status?: string };
        const status =
          body.email_status === 'sent'
            ? 'sent'
            : body.email_status === 'dedup'
              ? 'dedup'
              : 'queued_no_email';
        results.push({ email: row.email, status });
      } catch {
        results.push({ email: row.email, status: 'failed', message: "couldn't reach the service" });
      }
    }
    setSendResults(results);
    // Fire the `completed_at` marker (server-side · read on next login).
    try {
      await authedFetch(`${backend}/onboarding/crew/completed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } catch { /* non-fatal */ }
    setPhase('results');
  }, [matchResult, selected, backend]);

  /**
   * Wave 1 · BUG-003 (2026-07-12) — before advancing to Home, check
   * whether the customer needs to claim a handle. If so, open the
   * ``ClaimHandleSheet``. The sheet's own ``onClose`` calls
   * ``props.onDone()`` after the claim (or dismissal). If the handle
   * is already claimed, forward straight through.
   *
   * This does NOT gate onboarding on claim — dismissing the sheet
   * still lands the customer on Home. A later wave adds a 24h nudge
   * for the un-claimed cohort (out of scope for Wave 1).
   */
  const advanceToHome = useCallback(() => {
    // Sheet mounts when snapshot.handle is null. It self-guards on
    // ``lcId != null`` so a customer whose LC-ID hasn't minted yet
    // gets forwarded through instead of blocked.
    if (me.snapshot?.handle == null && me.snapshot?.lcId != null) {
      setHandleSheetOpen(true);
      return;
    }
    props.onDone();
  }, [me.snapshot?.handle, me.snapshot?.lcId, props]);

  const onDismiss = useCallback(async () => {
    // "Do this later" — do NOT dismiss forever · leave the shown marker
    // in place but do not fire completed/dismissed so /me still returns
    // shown_at only. If the user reopens Wallet they can retry from there.
    props.onDone();
  }, [props]);

  const onSkipForever = useCallback(async () => {
    const jwt = getJwt();
    if (jwt) {
      try {
        await authedFetch(`${backend}/onboarding/crew/dismissed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
      } catch { /* non-fatal */ }
    }
    props.onDone();
  }, [backend, props]);

  const toggleRow = useCallback((email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }, []);

  // ── Derived values ────────────────────────────────────────────
  const selectedRows = useMemo(() => {
    if (!matchResult) return [];
    return matchResult.matched.filter((r) => selected.has(r.email));
  }, [matchResult, selected]);

  const selectedMrrCents = useMemo(() => {
    return selectedRows.reduce((sum, r) => sum + (r.your_50pct_cents ?? 0), 0);
  }, [selectedRows]);

  const totalMrrCents = matchResult?.earning_potential_cents ?? 0;
  const totalOpportunityCents = useMemo(() => {
    if (!matchResult) return 0;
    return matchResult.matched.reduce(
      (sum, r) => sum + (r.estimated_opportunity_cents ?? 0), 0,
    );
  }, [matchResult]);

  const successCount = sendResults.filter(
    (r) => r.status === 'sent' || r.status === 'queued_no_email' || r.status === 'dedup',
  ).length;
  const failCount = sendResults.filter((r) => r.status === 'failed').length;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="crew-onboarding" data-phase={phase} data-testid="crew-onboarding">
      <div className="crew-onboarding__panel">
        <header className="crew-onboarding__header">
          <div className="crew-onboarding__eyebrow">
            <span>Step 1 of 1 · takes 30 seconds</span>
            <span className="crew-onboarding__eyebrow-pill">
              50% of every sub · for LIFE
            </span>
          </div>
        </header>

        {phase === 'hook' && (
          <div className="crew-onboarding__section crew-onboarding__hook">
            {/* Referral hero — mirrors the Outreach money-drop experience
                (routes/sync-mail-money-drop): big value prop, strong
                earnings line, one prominent "LINK WITH CONTACT DIRECTLY"
                action, supporting copy, skip. */}
            <h1 className="crew-onboarding__hero-h1">
              <span className="crew-onboarding__hero-money">$99.99/mo</span>
              {' · every clipper you share = '}
              <span className="crew-onboarding__hero-life">$50/mo for LIFE</span>
            </h1>
            <p className="crew-onboarding__hero-sub">
              Every clipper you skill-share with pays <b>$99.99</b> — you get{' '}
              <span className="crew-onboarding__hero-life">$50/mo</span>, every
              month, <span className="crew-onboarding__hero-life">for LIFE</span>.
              Two skill shares and your $99.99 is free.
            </p>

            {nativeInvite.subState.kind === 'idle' && (
              <>
                <button
                  type="button"
                  className="crew-onboarding__link-contact-btn"
                  onClick={() => void nativeInvite.pick()}
                  data-testid="crew-choose-contact"
                >
                  <span className="crew-onboarding__envelope-icon" aria-hidden="true" />
                  <span>Link with contact directly</span>
                </button>
                <p className="crew-onboarding__hero-sub crew-onboarding__hero-sub--tight">
                  Pick a contact from your device and invite them.
                </p>

                {/* Google Contacts / Gmail bulk scanner — HIDDEN for this
                    onboarding iteration (per product direction 2026-09-10).
                    NOT removed: `onConnect`, F5Scanner, googleOAuth,
                    productionOAuthDriver/HttpFetch/BatchLookup, the
                    connecting-google / scanning / finding-creators /
                    calculating / reveal phases and their backend routes
                    all remain wired and intact so this can be restored by
                    un-commenting the button below.
                <button
                  type="button"
                  className="crew-onboarding__link"
                  onClick={() => void onConnect()}
                  data-testid="crew-connect-google"
                >
                  Scan my whole network &rarr;
                </button>
                */}
              </>
            )}

            {nativeInvite.subState.kind === 'checking' && (
              <div className="crew-onboarding__native-card" data-testid="crew-native-checking">
                <p>Checking&hellip;</p>
              </div>
            )}

            {nativeInvite.subState.kind === 'existing-user' && (
              <div className="crew-onboarding__native-card" data-testid="crew-native-existing-user">
                <div className="crew-onboarding__native-name">
                  {nativeInvite.subState.displayName || '(no name on record)'}
                </div>
                <p><b>Already on Liquid Clips</b></p>
                <p>This contact already has an account — pick someone else.</p>
                <div className="crew-onboarding__native-actions">
                  <button
                    type="button"
                    className="crew-onboarding__link"
                    onClick={nativeInvite.dismissExistingUser}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {nativeInvite.subState.kind === 'lookup-error' && (
              <div className="crew-onboarding__native-card" data-testid="crew-native-lookup-error">
                <div className="crew-onboarding__native-name">
                  {nativeInvite.subState.displayName || '(no name on record)'}
                </div>
                <p>Couldn&rsquo;t check this contact — try again.</p>
                <div className="crew-onboarding__native-actions">
                  <button
                    type="button"
                    className="crew-onboarding__cta crew-onboarding__cta--primary"
                    onClick={nativeInvite.retryLookup}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="crew-onboarding__link"
                    onClick={nativeInvite.dismissLookupError}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {nativeInvite.subState.kind === 'need-email' && (
              <div className="crew-onboarding__native-card" data-testid="crew-native-need-email">
                <div className="crew-onboarding__native-name">
                  {nativeInvite.subState.displayName || '(no name on record)'}
                </div>
                <p>No email is saved for this contact. Add one to send a tracked invite.</p>
                <input
                  className="crew-onboarding__native-input"
                  type="email"
                  value={nativeInvite.manualEmail}
                  onChange={(e) => nativeInvite.setManualEmail(e.target.value)}
                  placeholder="person@example.com"
                  data-testid="crew-native-email-input"
                />
                {nativeInvite.manualEmailError && (
                  <p className="crew-onboarding__native-error">{nativeInvite.manualEmailError}</p>
                )}
                <div className="crew-onboarding__native-actions">
                  <button
                    type="button"
                    className="crew-onboarding__cta crew-onboarding__cta--primary"
                    onClick={nativeInvite.submitManualEmail}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className="crew-onboarding__link"
                    onClick={nativeInvite.cancelManualEmail}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {nativeInvite.pickerError && (
              <div className="crew-onboarding__error" role="alert">{nativeInvite.pickerError}</div>
            )}

            <div className="crew-onboarding__skip-row">
              <button
                type="button"
                className="crew-onboarding__skip-link"
                onClick={() => void onDismiss()}
                data-testid="crew-do-later"
              >
                Do this later
              </button>
              <button
                type="button"
                className="crew-onboarding__skip-link crew-onboarding__skip-link--muted"
                onClick={() => void onSkipForever()}
                data-testid="crew-skip-forever"
              >
                Skip &middot; give up <b>$1,000/mo</b> potential
              </button>
            </div>
          </div>
        )}

        {phase === 'native-matching' && (
          <div className="crew-onboarding__loading" data-testid="crew-native-matching">
            <div className="crew-onboarding__spinner" aria-hidden />
            <p>Checking your network&hellip;</p>
          </div>
        )}

        {phase === 'native-confirm' && matchResult && nativeContact && (
          <div className="crew-onboarding__section" data-testid="crew-native-confirm">
            <div className="crew-onboarding__native-card">
              <div className="crew-onboarding__native-name">
                {nativeContact.displayName || nativeContact.email}
              </div>
              <div className="crew-onboarding__row-email">{nativeContact.email}</div>
              {matchResult.matched[0]?.your_50pct_cents > 0 ? (
                <p>
                  Already earning on our radar — your cut when they subscribe:
                  {' '}<b>{fmtDollars(matchResult.matched[0].your_50pct_cents)}/mo</b>, for life.
                </p>
              ) : (
                <p>
                  We&rsquo;ll send {nativeContact.displayName
                    ? nativeContact.displayName.split(/\s+/)[0]
                    : 'them'} a branded invite with your referral link.
                  When they subscribe you earn <b>50%</b> of their subscription,
                  every month, for life.
                </p>
              )}
            </div>
            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => void onApproveSend()}
              data-testid="crew-native-send"
            >
              Send invitation &rarr;
            </button>
            <div className="crew-onboarding__secondary-row">
              <button
                type="button"
                className="crew-onboarding__link"
                onClick={resetNativePath}
              >
                Choose someone else
              </button>
              <button
                type="button"
                className="crew-onboarding__link crew-onboarding__link--muted"
                onClick={() => void onDismiss()}
              >
                Do this later
              </button>
            </div>
            {error && (
              <div className="crew-onboarding__error" role="alert">{error}</div>
            )}
          </div>
        )}

        {(phase === 'connecting-google'
          || phase === 'scanning'
          || phase === 'finding-creators'
          || phase === 'calculating') && (
          <div className="crew-onboarding__loading">
            <div className="crew-onboarding__spinner" aria-hidden />
            <ol className="crew-onboarding__loading-steps">
              <li data-active={phase === 'connecting-google'} data-done={phase !== 'connecting-google'}>
                Connecting Google
              </li>
              <li data-active={phase === 'scanning'} data-done={phase === 'finding-creators' || phase === 'calculating'}>
                Scanning your network
              </li>
              <li data-active={phase === 'finding-creators'} data-done={phase === 'calculating'}>
                Finding creators
              </li>
              <li data-active={phase === 'calculating'} data-done={false}>
                Calculating referral potential
              </li>
            </ol>
          </div>
        )}

        {phase === 'reveal' && matchResult && (
          <div className="crew-onboarding__section">
            <div className="crew-onboarding__reveal" data-testid="crew-reveal">
              <div className="crew-onboarding__reveal-eyebrow">Your network could generate</div>
              <div className="crew-onboarding__reveal-money">
                {fmtDollars(totalMrrCents)}
                <span className="crew-onboarding__reveal-mo">/mo</span>
              </div>
              <div className="crew-onboarding__reveal-sub">
                in monthly recurring revenue.
              </div>
              <div className="crew-onboarding__reveal-quote">
                That could pay for your subscription and dinner lol.
              </div>
              {totalOpportunityCents > 0 && (
                <div className="crew-onboarding__reveal-gap">
                  Combined opportunity your network is leaving on the table:
                  <b> {fmtDollars(totalOpportunityCents)}/mo</b>
                </div>
              )}
            </div>

            <div className="crew-onboarding__review">
              <div className="crew-onboarding__review-header">
                <div className="crew-onboarding__review-title">
                  Review recipients · {selectedRows.length} of {matchResult.matched.length} selected
                </div>
                <div className="crew-onboarding__review-total">
                  Your cut when they subscribe: <b>{fmtDollars(selectedMrrCents)}/mo</b>
                </div>
              </div>
              <div className="crew-onboarding__review-list">
                {matchResult.matched.map((r) => {
                  const isChecked = selected.has(r.email);
                  return (
                    <label key={r.email} className="crew-onboarding__row">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleRow(r.email)}
                        data-testid={`crew-row-${r.email}`}
                      />
                      <div className="crew-onboarding__row-body">
                        <div className="crew-onboarding__row-handle">
                          @{r.handle || r.email.split('@')[0]}
                          {r.earnings_verified_by_owner && (
                            <span className="crew-onboarding__row-verified" title="Owner-verified">✓</span>
                          )}
                        </div>
                        <div className="crew-onboarding__row-meta">
                          {r.niche && <span>{r.niche}</span>}
                          {r.audience_size ? <span>· {fmtAudience(r.audience_size)} audience</span> : null}
                        </div>
                        <div className="crew-onboarding__row-email">{r.email}</div>
                      </div>
                      <div className="crew-onboarding__row-mrr">
                        {r.your_50pct_cents > 0 ? (
                          <>+{fmtDollars(r.your_50pct_cents)}<span>/mo</span></>
                        ) : (
                          <span className="crew-onboarding__row-mrr-tbd">tbd</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => void onApproveSend()}
              disabled={selectedRows.length === 0}
              data-testid="crew-approve-send"
            >
              Send {selectedRows.length} invitation{selectedRows.length === 1 ? '' : 's'} →
            </button>
            <div className="crew-onboarding__secondary-row">
              <button
                type="button"
                className="crew-onboarding__link"
                onClick={() => void onDismiss()}
              >
                Do this later
              </button>
            </div>
            {error && (
              <div className="crew-onboarding__error" role="alert">{error}</div>
            )}
          </div>
        )}

        {phase === 'sending' && (
          <div className="crew-onboarding__loading">
            <div className="crew-onboarding__spinner" aria-hidden />
            <p>Sending invitations · your referral link is attached to every one.</p>
          </div>
        )}

        {phase === 'results' && (
          <div className="crew-onboarding__section">
            <div className="crew-onboarding__results" data-testid="crew-results">
              <div className="crew-onboarding__results-title">
                {successCount} invitation{successCount === 1 ? '' : 's'} on the way.
              </div>
              {failCount > 0 && (
                <div className="crew-onboarding__results-partial">
                  {failCount} couldn&rsquo;t send · we&rsquo;ll retry from Wallet.
                </div>
              )}
              <p className="crew-onboarding__results-body">
                We&rsquo;ll ping you in Wallet the moment one converts. Your
                commission stays with you every month, for life.
              </p>
              <ul className="crew-onboarding__results-list">
                {sendResults.map((r) => (
                  <li key={r.email} data-status={r.status}>
                    <b>{r.email}</b>
                    <span className="crew-onboarding__results-status">
                      {r.status === 'sent' && 'sent'}
                      {r.status === 'dedup' && 'already sent'}
                      {r.status === 'queued_no_email' && 'queued'}
                      {r.status === 'failed' && (r.message ?? 'failed')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => {
                window.location.hash = '#/wallet';
                // Wave 1 · BUG-003 · handle-claim gate before completion.
                advanceToHome();
              }}
              data-testid="crew-open-wallet"
            >
              Open Wallet →
            </button>
            <div className="crew-onboarding__secondary-row">
              <button
                type="button"
                className="crew-onboarding__link"
                onClick={advanceToHome}
              >
                Continue to Home
              </button>
            </div>
          </div>
        )}

        {phase === 'empty' && (
          <div className="crew-onboarding__section">
            <div className="crew-onboarding__empty" data-testid="crew-empty">
              <div className="crew-onboarding__empty-title">
                None of your contacts are on our list yet.
              </div>
              <p>
                That&rsquo;s okay — every clipper you share Liquid Clips with
                pays out 50% of their subscription every month, for life. Your
                referral link:
              </p>
              <code>{matchResult?.referral_share_url ?? 'https://liquidclips.app/'}</code>
            </div>
            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => props.onDone()}
              data-testid="crew-continue-home"
            >
              Continue to Home
            </button>
          </div>
        )}

        {phase === 'denied' && (
          <div className="crew-onboarding__section">
            <div className="crew-onboarding__error-card" data-testid="crew-denied">
              <div className="crew-onboarding__error-title">
                You said no to Google — that&rsquo;s cool.
              </div>
              <p>
                You can connect anytime from Wallet. Every referral still pays
                you 50% of their subscription.
              </p>
            </div>
            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => props.onDone()}
            >
              Continue to Home
            </button>
            <div className="crew-onboarding__secondary-row">
              <button
                type="button"
                className="crew-onboarding__link"
                onClick={() => setPhase('hook')}
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === 'misconfigured' && (
          <div className="crew-onboarding__section">
            <div className="crew-onboarding__error-card" data-testid="crew-misconfigured">
              <div className="crew-onboarding__error-title">
                Google connection isn&rsquo;t set up yet.
              </div>
              <p>
                Come back after Daniel finishes the Google setup. Your account
                is otherwise ready — you can keep going without connecting.
              </p>
            </div>
            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => props.onDone()}
            >
              Continue to Home
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="crew-onboarding__section">
            <div className="crew-onboarding__error-card" data-testid="crew-error">
              <div className="crew-onboarding__error-title">
                Something got in the way.
              </div>
              <p>{error ?? 'Try again in a moment.'}</p>
            </div>
            <button
              type="button"
              className="crew-onboarding__cta crew-onboarding__cta--primary"
              onClick={() => { setError(null); setPhase('hook'); }}
            >
              Try again
            </button>
            <div className="crew-onboarding__secondary-row">
              <button
                type="button"
                className="crew-onboarding__link"
                onClick={advanceToHome}
              >
                Continue to Home
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Wave 1 · BUG-003 · first-run handle claim sheet. Self-guards
       *  on ``lcId != null && handle == null`` inside ``ClaimHandleSheet``
       *  so it renders nothing when either condition fails. Closing the
       *  sheet forwards through to Home. */}
      {handleSheetOpen && (
        <ClaimHandleSheet
          mountReason="first-run"
          onClose={() => {
            setHandleSheetOpen(false);
            props.onDone();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString()}`;
}

function fmtAudience(n: number | null): string {
  if (n == null || n <= 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export type { ScanState };
