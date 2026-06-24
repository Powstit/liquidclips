/**
 * Whop OAuth — client + server helpers for the "Whop main-lead" sign-in
 * door on /connect-desktop.
 *
 * Architecture (locked per memory `liquid-clips-whop-lead-decision`):
 *   - Whop = PRIMARY identity layer. Clerk = SECONDARY fallback.
 *   - The full OAuth flow (authorise → token → mint license JWT → deep-link)
 *     is already wired in `junior-backend/app/routes/auth_whop.py`. The
 *     marketing API routes (`/api/whop-oauth/start`, `/api/whop-oauth/callback`)
 *     act as same-origin shims so the user never sees a cross-domain hop in
 *     the URL bar, and so any future migration of OAuth state from backend
 *     to marketing has a clear seam.
 *   - No client secret is ever read in this module. The exchange happens
 *     server-side in junior-backend behind the Railway env wall.
 *
 * Public surface:
 *   - `WHOP_BACKEND_OAUTH_BASE`  — canonical backend OAuth root
 *   - `WHOP_ENABLED`             — feature flag (NEXT_PUBLIC_WHOP_SIGNIN_ENABLED)
 *   - `buildBackendStartUrl()`   — challenge → 302 target
 *   - `buildAffiliateUrl()`      — "no membership" CTA fallback target
 *   - `isValidChallenge()`       — shared challenge-shape validator
 *   - `WhopUrlState` + `readWhopUrlState()` — banner state derived from URL params
 */

/** Backend domain that owns the OAuth state machine. Override per-env if a
 *  preview ever needs to point at a non-prod backend. */
export const WHOP_BACKEND_OAUTH_BASE = (
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.liquidclips.app"
).replace(/\/+$/, "");

/** Feature flag — when false the Whop button hides and the page falls back to
 *  the Clerk-only flow. Toggle on Vercel via NEXT_PUBLIC_WHOP_SIGNIN_ENABLED. */
export const WHOP_ENABLED =
  process.env.NEXT_PUBLIC_WHOP_SIGNIN_ENABLED === "true";

/** Whop affiliate / product URL — surfaced on the "no membership" empty
 *  state banner so users can grab a Liquid Clips plan without leaving the
 *  activation flow. */
export const WHOP_AFFILIATE_URL = (
  process.env.NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL ?? ""
).trim();

/** Build the URL that kicks off the Whop OAuth flow on the canonical backend.
 *  Throws on malformed challenge so callers get a clear runtime signal in
 *  development instead of a silent 4xx on the backend route. */
export function buildBackendStartUrl(challenge: string): string {
  if (!isValidChallenge(challenge)) {
    throw new Error("whop-oauth: invalid challenge");
  }
  const params = new URLSearchParams({ challenge });
  return `${WHOP_BACKEND_OAUTH_BASE}/auth/whop/start?${params.toString()}`;
}

/** Build the affiliate CTA URL for the "no membership" empty state. Returns
 *  empty string if the env var isn't set — callers should hide the CTA. */
export function buildAffiliateUrl(): string {
  return WHOP_AFFILIATE_URL;
}

/** Shape gate matching the backend's `Query(..., min_length=8, max_length=128)`
 *  constraint. Allow URL-safe chars only — the desktop generates hex nonces,
 *  but accept the broader URL-safe charset so a future scheme change doesn't
 *  break the gate. */
export function isValidChallenge(challenge: string): boolean {
  if (!challenge || typeof challenge !== "string") return false;
  if (challenge.length < 8 || challenge.length > 128) return false;
  return /^[A-Za-z0-9_-]+$/.test(challenge);
}

/** Discriminant for the inline banner above the sign-in cards. Mirrors the
 *  exact query params the backend's /auth/whop/callback uses on its
 *  redirect-back to /connect-desktop, so the UI doesn't need to learn a
 *  parallel error vocabulary. */
export type WhopUrlState =
  | "none"
  | "nomembership"
  | "cancelled"
  | "disabled"
  | "error";

/** Read the banner state from `window.location`. SSR-safe (returns "none"). */
export function readWhopUrlState(search?: string): WhopUrlState {
  const raw =
    search ??
    (typeof window === "undefined" ? "" : window.location.search);
  if (!raw) return "none";
  const q = new URLSearchParams(raw);
  if (q.get("whop_nomembership") === "1") return "nomembership";
  if (q.get("whop_cancelled") === "1") return "cancelled";
  if (q.get("whop_disabled") === "1") return "disabled";
  if (q.get("whop_error")) return "error";
  return "none";
}
