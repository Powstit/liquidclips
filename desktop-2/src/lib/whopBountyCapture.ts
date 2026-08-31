/**
 * whopBountyCapture · Auto-detect a Whop bounty URL as the agency
 * navigates inside the in-app browser after creating a reward.
 *
 * The problem (v2.3.69 and earlier): Whop doesn't fire a
 * `bounty_created` webhook (verified in whop_bounty_mirror.py IRON
 * GATE IG-BOUNTY-08 · 79 real Whop webhook events, none for bounty
 * creation). So after an agency clicked "Post to Whop marketplace"
 * inside our in-app browser, filled the create form, and hit submit,
 * LC had no way to know a bounty had been created. The workaround
 * was manual copy-paste of the Whop URL into the campaign form.
 *
 * The fix: browse.rs now emits `browse:url-changed` on every child-
 * webview navigation. We subscribe here, match the URL against known
 * Whop bounty destination patterns, and dispatch a DOM event
 * (`lc:whop-bounty-captured`) that the campaign draft form + Kade
 * wizard listen for. No shell rebuild after this — pure frontend
 * additions once the Rust event is in place (v2.3.70 shell).
 *
 * URL patterns matched:
 *   • https://whop.com/dashboard/{companyId}/bounties/b_{id}[/...]
 *   • https://whop.com/dashboard/{companyId}/content-rewards/{id}[/...]
 *   • https://whop.com/c/{brandSlug}/bounties/b_{id}[/...]
 *
 * Non-matches ignored silently (announcements, search results,
 * profile pages, etc.) so subscribers see only capture-worthy URLs.
 *
 * Idempotency: the capture event is fired ONCE per unique bounty id
 * per browser-overlay session so agencies who scroll into their new
 * bounty then back out don't get duplicate fills.
 */
import { subscribeBrowseUrlChanges } from "./browse";

/** Payload dispatched on `lc:whop-bounty-captured`. */
export interface WhopBountyCaptured {
  /** The full Whop bounty URL as captured. */
  url: string;
  /** The `b_...` bounty id parsed from the path, when present.
   *  content-rewards paths don't always carry a `b_` prefix; in that
   *  case we return the raw id segment. */
  bountyId: string;
  /** ISO timestamp of capture (for telemetry + de-dup TTLs). */
  capturedAt: string;
  /** 2026-08-31 · which "post to Whop" session this capture belongs to
   *  — see setActiveBountyCaptureSession() below. `null` when no
   *  consumer had registered a session at capture time (e.g. an agency
   *  just browsing Whop for an unrelated reason); consumers MUST treat
   *  a `null` or mismatched sessionId as "not mine" and ignore it. */
  sessionId: string | null;
}

/**
 * 2026-08-31 · BUG FIX — cross-campaign misattribution.
 *
 * Before this: the capture event carried no campaign/session identity
 * at all, and BrowseOverlay's clipboard-fallback ran on EVERY overlay
 * close (not just ones opened for bounty creation), always stamping
 * `capturedAt` as "now" — so a bounty URL copied days earlier for an
 * unrelated reason (e.g. shared in Discord) looked "fresh" to any
 * consumer's staleness guard and could silently fill the wrong
 * campaign's reward field.
 *
 * Fix: whichever component is about to open the in-app browser for
 * "post to Whop" / "connect a bounty" calls
 * `setActiveBountyCaptureSession(someUniqueId)` first, then clears it
 * (`setActiveBountyCaptureSession(null)`) on unmount. Both capture
 * paths below stamp the CURRENT session id at capture time; consumers
 * compare it against the id they registered and ignore anything that
 * doesn't match — including captures with no session at all, which
 * covers "agency browsing Whop for an unrelated reason." BrowseOverlay
 * also skips the clipboard-fallback read entirely when no session is
 * active, so an unrelated browse session no longer touches the
 * clipboard or fires this event at all.
 */
let activeSessionId: string | null = null;

/** Register (or clear, with `null`) the session id for the "post to
 *  Whop" flow currently in progress. Exported so BrowseOverlay can also
 *  check `hasActiveBountyCaptureSession()` before bothering to read the
 *  clipboard on close. */
export function setActiveBountyCaptureSession(id: string | null): void {
  activeSessionId = id;
}

/** Whether any consumer currently has a bounty-capture session open. */
export function hasActiveBountyCaptureSession(): boolean {
  return activeSessionId !== null;
}

/** Dispatched to `window` whenever a Whop bounty URL is captured. */
export const WHOP_BOUNTY_CAPTURED_EVENT = "lc:whop-bounty-captured";

// Whop bounty URL patterns. Kept as an array so we can extend without
// touching the matcher body. Each regex must expose a `bountyId`
// named capture group.
const WHOP_BOUNTY_PATTERNS: readonly RegExp[] = [
  // Dashboard bounty create/detail (most common landing after submit).
  /^https:\/\/whop\.com\/dashboard\/[^/]+\/bounties\/(?<bountyId>b_[a-zA-Z0-9_-]+)(?:[/?#].*)?$/i,
  // Dashboard content-rewards (newer Whop surface).
  /^https:\/\/whop\.com\/dashboard\/[^/]+\/content-rewards\/(?<bountyId>[a-zA-Z0-9_-]+)(?:[/?#].*)?$/i,
  // Public brand bounty page (some agencies land here after create).
  /^https:\/\/whop\.com\/c\/[^/]+\/bounties\/(?<bountyId>b_[a-zA-Z0-9_-]+)(?:[/?#].*)?$/i,
];

/**
 * Pure matcher — returns `null` when the URL isn't a Whop bounty
 * surface, or the parsed id when it is. Exported for tests + for the
 * clipboard-fallback path that runs on overlay close.
 */
export function parseWhopBountyUrl(url: string): { bountyId: string; url: string } | null {
  if (!url || typeof url !== "string") return null;
  for (const pattern of WHOP_BOUNTY_PATTERNS) {
    const match = pattern.exec(url);
    const id = match?.groups?.bountyId;
    if (id) return { bountyId: id, url };
  }
  return null;
}

/**
 * Start listening for Whop bounty URLs. Dispatches on the first
 * capture per unique bounty id per subscription — later navigations
 * to the same bounty don't re-fire. Returns an unsubscribe fn.
 *
 * Idempotency window = subscription lifetime. Reset it by
 * unsubscribing + resubscribing (which BrowseOverlay does implicitly
 * on each overlay open/close cycle).
 */
export async function subscribeWhopBountyCapture(): Promise<() => void> {
  const capturedIds = new Set<string>();
  const unlistenUrlChanges = await subscribeBrowseUrlChanges((url) => {
    const parsed = parseWhopBountyUrl(url);
    if (!parsed) return;
    if (capturedIds.has(parsed.bountyId)) return;
    capturedIds.add(parsed.bountyId);
    const payload: WhopBountyCaptured = {
      url: parsed.url,
      bountyId: parsed.bountyId,
      capturedAt: new Date().toISOString(),
      sessionId: activeSessionId,
    };
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent<WhopBountyCaptured>(WHOP_BOUNTY_CAPTURED_EVENT, {
            detail: payload,
          }),
        );
      } catch {
        /* swallow — browser preview or CSP block */
      }
    }
  });
  return unlistenUrlChanges;
}

/**
 * Clipboard-fallback path. When BrowseOverlay closes after a session
 * that opened a Whop bounty-create URL, we read the clipboard once —
 * if it contains a Whop bounty URL the user copied from Whop's
 * confirmation page, we fire the same capture event so the wizard +
 * campaign form still auto-fill.
 *
 * Safe on macOS Tauri: navigator.clipboard.readText prompts once for
 * permission (post macOS 14 · WKWebView), user's grant persists.
 * Every failure is swallowed so a blocked read never blocks UI.
 *
 * Returns true if a bounty URL was captured from clipboard.
 */
export async function tryCaptureFromClipboard(): Promise<boolean> {
  // 2026-08-31 — no session registered means no consumer is actually
  // waiting on a capture right now (e.g. an unrelated browse session
  // closing). Skip the clipboard read entirely rather than fire an
  // event nothing should accept — see the fix note above.
  if (!hasActiveBountyCaptureSession()) return false;
  if (typeof navigator === "undefined") return false;
  const clip = navigator.clipboard;
  if (!clip || typeof clip.readText !== "function") return false;
  try {
    const text = await clip.readText();
    const parsed = parseWhopBountyUrl(text);
    if (!parsed) return false;
    const payload: WhopBountyCaptured = {
      url: parsed.url,
      bountyId: parsed.bountyId,
      capturedAt: new Date().toISOString(),
      sessionId: activeSessionId,
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<WhopBountyCaptured>(WHOP_BOUNTY_CAPTURED_EVENT, {
          detail: payload,
        }),
      );
    }
    return true;
  } catch {
    return false;
  }
}
