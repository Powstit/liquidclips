/**
 * referralUrl · Sprint 2 C3 · deterministic referral URL for the
 * attributable watermark and any share affordance.
 *
 * ⚠ IRON GATE IG-COMPOSER-R · Referral URL contract.
 *
 * Per LOCKED memory liquid_clips_whop_affiliate_system.md, the referral
 * URL is DETERMINISTIC from the user's identity handle:
 *
 *     https://liquidclips.app/r/{handle}
 *
 * which 302-redirects on the marketing site to
 * `whop.com/checkout/studio?a={handle}`. Whop owns the affiliate
 * attribution ledger · we NEVER rebuild it.
 *
 * Consumer wire-in points:
 *   * Watermark render pipeline (writes handle to
 *     CockpitSettings.baseWindow.watermarkHandle · exporter builds the
 *     final URL at burn time).
 *   * Copy-link affordances (Earn tab, Crew-invite modal, etc).
 *   * Any deep-linkable "share your seat" copy.
 *
 * Anti-patterns this module forbids (enforced by test + lint):
 *   * Fetching the URL from a backend endpoint · adds latency + a
 *     failure mode with no upside. The URL is a pure function of the
 *     handle.
 *   * Encoding a JWT / token in the URL · attribution is Whop's job
 *     via the affiliate override, not our URL surface.
 *   * Silently returning the marketing landing page when the handle
 *     is missing · the caller must decide how to render an unset
 *     referral affordance.
 */

/** The immutable URL prefix. Anything downstream that hardcodes this
 *  string outside this module is drifting the contract. */
export const REFERRAL_URL_PREFIX = "https://liquidclips.app/r/";

/**
 * Build the referral URL for a given handle. Returns null if the
 * handle is null/empty so the caller can decide how to render the
 * "not yet claimed" state (hide the share button, show a coach mark,
 * etc.). Never falls back to the marketing landing page.
 */
export function getReferralUrl(handle: string | null | undefined): string | null {
  if (!handle) return null;
  const trimmed = handle.trim().replace(/^@+/, "");
  if (trimmed.length === 0) return null;
  return `${REFERRAL_URL_PREFIX}${encodeURIComponent(trimmed)}`;
}

/**
 * Parse a referral URL back to the handle it encodes. Used by
 * marketing-side telemetry / test doubles. Returns null on any
 * non-liquid URL so the caller can no-op.
 */
export function parseReferralUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith(REFERRAL_URL_PREFIX)) return null;
  const raw = url.slice(REFERRAL_URL_PREFIX.length);
  if (raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
