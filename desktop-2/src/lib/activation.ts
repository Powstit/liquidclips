/**
 * activation.ts · P1-1D-a · Headless activation state machine + parser
 *
 * Headless plumbing only. No UI. No native Keychain (P1-1F). No Rust
 * commands. No Whop OAuth scope changes. No tier UI gating. No 401
 * self-heal. No HQ bridge verbs.
 *
 * Flow (locked from legacy parity per p1-1c audit):
 *   1. beginActivation() → randomChallenge() → persist pendingChallenge
 *      in sessionStorage so the nonce survives a page reload.
 *   2. Consumer opens an external URL carrying ?challenge=<nonce>
 *      (Clerk path via account-app · OR Whop path via backend OAuth).
 *      P1-1D ships only the receiver; the UI opener lands in P1-1E.
 *   3. OS / Tauri / browser returns
 *      liquidclips://activate?token=<jwt>&challenge=<nonce>[&source=…]
 *   4. handleActivationUrl(url) parses, verifies the challenge matches,
 *      writes the JWT via authStorage.setJwt(), clears the nonce.
 *   5. Post-activation orchestrator fires GET /sync + GET /me in
 *      parallel. Endpoint failure DOES NOT clear the JWT · we surface
 *      a `degraded: true` flag instead.
 *
 * Public surface is intentionally small · the file owns the activation
 * primitives only, no broader auth state. A `useAuth()` hook is a
 * P1-1G concern.
 */

import { useEffect, useState } from "react";
import { setJwt, clearJwt } from "./authStorage";
import { humanError } from "../design-os/engine/sidecarCall";
import { logLoginStep } from "./loginTelemetry";

/* ─── Public types ──────────────────────────────────────────────────── */

export type ActivationStatus =
  | "idle"        // No activation in flight
  | "waiting"     // beginActivation() called · waiting for deep-link
  | "activating"  // Deep-link arrived · parsing + post-sync in progress
  | "activated"   // JWT stored · post-sync optional
  | "failed";     // Parser rejected · challenge mismatch · timeout

export type ActivationSource = "clerk" | "whop" | "whop-checkout" | "unknown";

/* J1 STRAND 1 fix · trusted backend sources whose deep links are minted
 * by our own signed backend flow (Ed25519 JWT · 30-day expiry) AND
 * cannot include a challenge because the user never touched the
 * desktop before the mint. For these sources we skip the challenge
 * check because:
 *   1. Cold-email / checkout-first buyers never touched the desktop
 *      before purchase · there is no `pendingChallenge` in storage.
 *   2. The JWT signature + short expiry already provide the anti-replay
 *      protection the challenge nonce was designed for.
 *
 * 2026-07-05 · SECURITY · bug-hunt-lens flagged that `"whop"` (the
 * legacy OAuth callback source at auth_whop.py:427) MUST NOT be in
 * this set. That path DOES mint a challenge (`?challenge={state}`)
 * as anti-replay for the OAuth code exchange · adding it to the
 * challengeless allowlist would defeat that guarantee for any URL
 * that happened to arrive without a challenge param. Keep this set
 * strictly limited to sources that CANNOT emit a challenge by
 * design (i.e. the mint happens after checkout completes on Whop's
 * side, without desktop involvement).
 *
 * See junior-backend/app/routes/whop_checkout_success.py for the
 * only current emitter of a challengeless deep-link. */
const TRUSTED_CHALLENGELESS_SOURCES: ReadonlySet<string> = new Set([
  "whop-checkout",
]);

export interface ActivationSnapshot {
  status: ActivationStatus;
  error: string | null;
  /** Whichever door the deep-link came from. `unknown` when the URL
   *  doesn't carry the optional `?source=` query. */
  lastTokenSource: ActivationSource | null;
  /** True when JWT stored but /sync or /me failed. Never clears the
   *  JWT · the next /sync call can recover. */
  degraded: boolean;
  /** Tier from the post-activation /sync or /me response · null until
   *  the sync orchestrator completes. */
  tier: string | null;
  /** Email from the post-activation /me response. */
  email: string | null;
}

/* ─── Module-private state ──────────────────────────────────────────── */

const PENDING_CHALLENGE_STORAGE_KEY = "lc.activation.pending_challenge.v1";
const ACTIVATION_TIMEOUT_MS = 5 * 60 * 1000;

let snapshot: ActivationSnapshot = freshSnapshot();
const listeners = new Set<(s: ActivationSnapshot) => void>();
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

function freshSnapshot(): ActivationSnapshot {
  return {
    status: "idle",
    error: null,
    lastTokenSource: null,
    degraded: false,
    tier: null,
    email: null,
  };
}

function emit(next: Partial<ActivationSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l(snapshot);
}

function readPendingChallenge(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(PENDING_CHALLENGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePendingChallenge(value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.sessionStorage.removeItem(PENDING_CHALLENGE_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(PENDING_CHALLENGE_STORAGE_KEY, value);
    }
  } catch { /* sessionStorage unavailable · silent */ }
}

/* ─── Nonce + lifecycle ─────────────────────────────────────────────── */

/** Cryptographically random 64-hex challenge. 32 bytes from
 *  `crypto.getRandomValues`. Returns a placeholder during SSR. */
export function randomChallenge(): string {
  if (typeof window === "undefined" || !window.crypto?.getRandomValues) {
    return "lc-no-crypto-available";
  }
  const buf = new Uint8Array(32);
  window.crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Start an activation flow · returns the nonce so the caller can
 *  embed it in the external URL it opens. Idempotent: calling twice
 *  cancels the prior nonce + timer and issues a fresh one. */
export function beginActivation(): string {
  // P1-1F-a · a fresh activation flow re-arms the dampener so a NEW
  // bad token (different from the one that triggered the prior 401)
  // can self-heal on its own.
  resetAuthDampener();
  const nonce = randomChallenge();
  writePendingChallenge(nonce);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutHandle = setTimeout(() => {
    if (snapshot.status === "waiting") {
      emit({
        status: "failed",
        error: "Activation timed out · please try signing in again.",
      });
      writePendingChallenge(null);
    }
    timeoutHandle = null;
  }, ACTIVATION_TIMEOUT_MS);
  emit({ ...freshSnapshot(), status: "waiting" });
  return nonce;
}

/** Cancel any in-flight activation, clear the nonce, reset to idle. */
export function clearActivation(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  writePendingChallenge(null);
  /* P1-1F-a · a manual user-initiated reset re-arms the dampener too. */
  resetAuthDampener();
  emit(freshSnapshot());
}

/* ─── Parser ────────────────────────────────────────────────────────── */

export interface ParsedActivation {
  token: string;
  /** J1 STRAND 1 fix · null when the deep link came from a trusted
   *  backend source (see TRUSTED_CHALLENGELESS_SOURCES) that mints the
   *  JWT server-side after checkout · cold-email buyers have no
   *  pending challenge in localStorage to match against. For every
   *  other source (legacy OAuth path) this stays a non-empty string
   *  and the caller MUST verify it against the pending nonce. */
  challenge: string | null;
  source: ActivationSource;
}

/** Parse a raw `liquidclips://activate?token=…&challenge=…` URL.
 *  Returns the activation payload OR a structured error. Never throws. */
export function parseActivationUrl(rawUrl: string): ParsedActivation | { error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "Activation URL is malformed." };
  }
  if (url.protocol !== "liquidclips:") {
    return { error: `Unsupported scheme · expected liquidclips:, got ${url.protocol}` };
  }
  if (url.hostname !== "activate") {
    return { error: `Unsupported verb · expected activate, got ${url.hostname || "(empty)"}` };
  }
  const token = url.searchParams.get("token");
  if (!token || token.length === 0) {
    return { error: "Activation URL missing token." };
  }
  const sourceParam = url.searchParams.get("source");
  const source: ActivationSource =
    sourceParam === "whop"
      || sourceParam === "clerk"
      || sourceParam === "whop-checkout"
      ? sourceParam
      : "unknown";
  const rawChallenge = url.searchParams.get("challenge");
  const challenge = rawChallenge && rawChallenge.length > 0 ? rawChallenge : null;
  // J1 STRAND 1 fix · challenge is only required when the source is NOT
  // in the trusted-backend allowlist. Trusted sources ride on the
  // Ed25519 signature + 30-day expiry for anti-replay; legacy sources
  // still MUST carry a challenge that matches the pending nonce.
  if (!challenge && !TRUSTED_CHALLENGELESS_SOURCES.has(sourceParam ?? "")) {
    return { error: "Activation URL missing challenge." };
  }
  return { token, challenge, source };
}

/* ─── Post-activation sync orchestrator ─────────────────────────────── */

interface SyncResponse {
  tier?: string;
  founder?: boolean;
  subscription_status?: string;
  billing_provider?: string;
  features?: Record<string, unknown>;
  new_license_jwt?: string;
  remaining_exports?: number;
  admin_override?: boolean;
  /** v2.2.15 · null when not on trial. Otherwise 7 - days-since-signup, floored at 0. */
  trial_days_remaining?: number | null;
  /** v2.2.15 · true after user clicks "Approve upgrade now" but before Whop webhook lands. */
  trial_convert_pending?: boolean;
  /** Sprint G.1 · backend-shipped milestone stream. Consumed by
   *  onboardingEmitter; every canonical key is present with null for
   *  unstamped milestones. Default {} keeps the emitter's diff logic
   *  safe when the field is absent (older backend / test mocks). */
  onboarding_status?: Record<string, string | null>;
}

interface MeResponse {
  email?: string;
  effective_tier?: string;
  raw_tier?: string;
  admin_override?: boolean;
}

/** Mirrors the helper in sidecar-stub. Inlined here (6 LOC) so the
 *  module stays self-contained and avoids broadening sidecar-stub's
 *  export surface during a non-refactor phase. */
function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/* ─── 401 self-heal (P1-1F-a) ──────────────────────────────────────── */

/** Discriminated result for safeGet · lets the caller distinguish
 *  "the JWT is bad" from "the backend is slow" from "we got data". */
export type FetchOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "auth-fail"; status: 401 | 403 }       // JWT rejected by backend
  | { kind: "server-error"; status: number }        // 5xx · non-auth 4xx
  | { kind: "network" };                            // fetch threw · CORS · offline · DNS

/** Module-level dampener · once a 401/403 has triggered the JWT-clear,
 *  subsequent auth-fails in the same session don't re-fire `emit` or
 *  re-clear (the JWT is already gone). Prevents an auth storm where
 *  many parallel fetches all see 401 and emit "failed" repeatedly. */
let authDampenerFired = false;

function isAuthStatus(status: number): status is 401 | 403 {
  return status === 401 || status === 403;
}

async function safeGet<T>(path: string, jwt: string): Promise<FetchOutcome<T>> {
  try {
    const r = await fetch(`${lcBackendUrl()}${path}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (isAuthStatus(r.status)) {
      return { kind: "auth-fail", status: r.status };
    }
    if (!r.ok) {
      return { kind: "server-error", status: r.status };
    }
    try {
      const data = (await r.json()) as T;
      return { kind: "ok", data };
    } catch {
      // Malformed JSON · treat as server-error · JWT is fine.
      return { kind: "server-error", status: r.status };
    }
  } catch {
    return { kind: "network" };
  }
}

/** P1-1F-a · centralized 401/403 self-heal hook.
 *
 *  When the backend explicitly REJECTS a JWT (only 401 or 403 reach
 *  here) · clear the stored license + emit the state machine to
 *  `"failed"` with a "session expired · please sign in again" error.
 *
 *  Idempotent · subsequent calls during the same session no-op via the
 *  dampener flag. This is the ONE place that clears a JWT in response
 *  to backend behavior · network failures / 500s / malformed JSON
 *  NEVER reach here.
 *
 *  Public so non-activation call sites (sidecar-stub fetches in a
 *  follow-up phase) can request the same self-heal · the dampener
 *  shields callers from re-clearing what's already gone. */
export function notifyAuthFailure(reason?: string): void {
  if (authDampenerFired) return;
  authDampenerFired = true;
  try { clearJwt(); } catch { /* clear is best-effort */ }
  writePendingChallenge(null);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  emit({
    status: "failed",
    error: reason ?? "Session expired · please sign in again.",
    lastTokenSource: null,
    degraded: false,
    tier: null,
    email: null,
  });
}

/** Reset the dampener · used by beginActivation() so a fresh sign-in
 *  flow can self-heal again on its own 401. Without this, a user who
 *  hit a 401, signed in again, then hit another 401 mid-session would
 *  silently degrade without a state-machine flip. */
function resetAuthDampener(): void {
  authDampenerFired = false;
}

/* ─── Public handlers ───────────────────────────────────────────────── */

/** Handle a deep-link activation URL. Idempotent and reentrant-safe.
 *  Verifies the challenge against the nonce minted by beginActivation()
 *  before writing the JWT. Never throws · all failure paths route
 *  through the state machine. */
export async function handleActivationUrl(rawUrl: string): Promise<void> {
  emit({ status: "activating", error: null });
  logLoginStep("deep_link_arrived");

  const parsed = parseActivationUrl(rawUrl);
  if ("error" in parsed) {
    logLoginStep("activation_failed", { stage: "parse", error: parsed.error });
    emit({ status: "failed", error: parsed.error });
    return;
  }
  // J1 STRAND 1 fix · challenge check is bypassed ONLY when parser
  // returned a null challenge AND the source is in the trusted
  // backend allowlist (whop-checkout · whop). This is the cold-email
  // conversion path: buyer completes Whop checkout before ever opening
  // the desktop, so no `pendingChallenge` was minted in localStorage.
  // The JWT signature + 30-day expiry are the authentication in that
  // path. For every legacy URL that DOES carry a challenge, the match
  // check runs exactly as before.
  const bypassChallenge =
    parsed.challenge === null
    && TRUSTED_CHALLENGELESS_SOURCES.has(parsed.source);
  if (!bypassChallenge) {
    const pending = readPendingChallenge();
    if (!pending || pending !== parsed.challenge) {
      logLoginStep("activation_failed", { stage: "challenge_mismatch" });
      emit({
        status: "failed",
        error: "Activation challenge mismatch · re-start sign in.",
      });
      return;
    }
  }

  // Store JWT first · the rest of the flow is best-effort enrichment.
  // P1-1D-c patch · token storage itself can fail (localStorage quota,
  // private-browsing, disabled storage). That's the only legitimate
  // post-parse path to `"failed"` per spec.
  try {
    setJwt(parsed.token);
    logLoginStep("activation_succeeded", { source: parsed.source });
  } catch (e) {
    // 2026-07-05 · CM-T5 · humanError sweep. Was raw e.message / String(e)
    // which leaks Python tracebacks + "quota exceeded" storage errors
    // straight into user-visible UI copy.
    logLoginStep("activation_failed", { stage: "jwt_store", error: humanError(e) });
    emit({ status: "failed", error: `Couldn't store license · ${humanError(e)}` });
    return;
  }
  // 2026-07-05 · rpc-contract-lens P1-A · mirror the JWT into the
  // macOS Keychain via the explicit auth-action helper. Without this
  // the deep-link path stored ONLY in localStorage — a webview
  // storage wipe on runtime bundle swap / quota purge would silently
  // sign the user out on next launch even though activation "worked."
  // Fire-and-forget · the primary emit("activated") below is
  // localStorage-driven so a keychain-write failure never blocks the
  // user's sign-in. See authStorage.ts:111 for the allowlist logic.
  void import("./authStorage")
    .then((mod) => mod.setJwtKeychainForAuthAction(parsed.token))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[activation] keychain mirror failed:", e);
    });
  writePendingChallenge(null);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  emit({
    status: "activated",
    error: null,
    lastTokenSource: parsed.source,
    degraded: false,
  });

  // Post-activation /sync + /me · parallel · best-effort.
  //
  // P1-1F-a · the orchestrator now distinguishes:
  //   - auth-fail (401/403)         → JWT rejected · self-heal via
  //                                    notifyAuthFailure() · this flips
  //                                    status to "failed" · the JWT
  //                                    stored 2 emits ago gets cleared
  //                                    immediately. Possible if the
  //                                    backend rotated keys between the
  //                                    mint and the post-mint /sync.
  //   - server-error / network      → JWT preserved · just degraded=true
  //                                    (matches prior P1-1D-c behavior)
  //   - ok                          → use the payload
  const [syncResp, meResp] = await Promise.all([
    safeGet<SyncResponse>("/sync", parsed.token),
    safeGet<MeResponse>("/me", parsed.token),
  ]);

  // Auth-fail on EITHER endpoint after a fresh JWT mint is the strongest
  // possible signal that the token is bad · clear immediately.
  if (syncResp.kind === "auth-fail" || meResp.kind === "auth-fail") {
    notifyAuthFailure(
      "Backend rejected the new license right after activation · please sign in again.",
    );
    return;
  }

  let degraded = false;
  let nextTier = snapshot.tier;
  let nextEmail = snapshot.email;

  if (syncResp.kind === "ok") {
    const data = syncResp.data;
    if (data.new_license_jwt) {
      try {
        setJwt(data.new_license_jwt);
      } catch {
        degraded = true;
      }
    }
    if (typeof data.tier === "string") nextTier = data.tier;
    // Sprint G.2 · feed the onboarding milestone snapshot into the
    // emitter. First observation runs a backfill (no events fire);
    // subsequent observations fire `onboarding:milestone` for every
    // null → timestamp transition. KadeController subscribes.
    if (data.onboarding_status && typeof data.onboarding_status === "object") {
      try {
        const { consumeSyncSnapshot } = await import("./onboardingEmitter");
        consumeSyncSnapshot(data.onboarding_status);
      } catch {
        /* emitter is fire-and-forget · never blocks activation */
      }
    }
  } else {
    // network OR server-error · JWT preserved · marked degraded only.
    degraded = true;
  }

  if (meResp.kind === "ok") {
    const data = meResp.data;
    if (typeof data.email === "string") nextEmail = data.email;
    if (typeof data.effective_tier === "string") nextTier = data.effective_tier;
  } else {
    // network OR server-error · JWT preserved · marked degraded only.
    degraded = true;
  }

  emit({ tier: nextTier, email: nextEmail, degraded });

  /* 2026-06-30 · activation:complete · downstream surfaces that hydrate
   * user-scoped state (Settings carrot panel, WalletPanel) subscribe so
   * their mounted-once fetch refreshes when the user activates while the
   * route is already open. Lazy dynamic import so the activation module
   * stays free of cross-cuts to the design-os tree; the import cost is
   * paid once per activation, not per render. */
  try {
    const { bus } = await import("../design-os/bridge");
    bus.emit("activation:complete", { source: parsed.source });
  } catch {
    /* bus unavailable in browser preview / unit tests · silent OK. */
  }
}

/** Synchronous read of the current state · for non-React consumers. */
export function getActivationSnapshot(): ActivationSnapshot {
  return snapshot;
}

/* ─── React hook ────────────────────────────────────────────────────── */

export interface UseActivationApi extends ActivationSnapshot {
  beginActivation: () => string;
  handleActivationUrl: (url: string) => Promise<void>;
  clearActivation: () => void;
}

export function useActivation(): UseActivationApi {
  const [s, setS] = useState<ActivationSnapshot>(snapshot);
  useEffect(() => {
    listeners.add(setS);
    setS(snapshot);
    return () => { listeners.delete(setS); };
  }, []);
  return {
    ...s,
    beginActivation,
    handleActivationUrl,
    clearActivation,
  };
}

/* ─── Test seam ─────────────────────────────────────────────────────── */

/** Resets module-level state · for unit tests only. */
export function _resetActivationForTests(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  listeners.clear();
  snapshot = freshSnapshot();
  writePendingChallenge(null);
  /* P1-1F-a · reset the auth dampener so each test starts fresh. */
  resetAuthDampener();
}

/* TASK 1 · Playwright harness test seam. Exposes the activation
 * primitives on `window.__lcActivation` so the end-to-end activation
 * spec can drive begin / handleUrl / clear and read the snapshot
 * without mounting React components or relying on the native deep-link
 * runtime (which is Tauri-only). Mirrors `window.__lcBus` and
 * `window.__lcInbox`. */
if (typeof window !== "undefined") {
  const w = window as unknown as { __lcActivation?: unknown };
  if (!w.__lcActivation) {
    w.__lcActivation = {
      begin: beginActivation,
      handleUrl: handleActivationUrl,
      clear: clearActivation,
      snapshot: getActivationSnapshot,
      notifyAuthFailure,
    };
  }
}
