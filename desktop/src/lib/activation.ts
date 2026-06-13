import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openSmart as openExternal } from "./openSmart";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { sidecar, humanError } from "./sidecar";
import { primeLicenseJwtCache } from "./backend";
import { recordWhopAuthEvent } from "./whop-iframe";

// ───── IRON GATE IG-004 (v0.4.21 + v0.7.x) — see desktop/docs/IRON_GATES.md ─────
// Auth + activation bridge. Pairs with the 401-self-heal path in backend.ts
// and the `junior://` deep-link plugin in src-tauri/src/lib.rs. Don't add a
// manual JWT paste flow, don't remove the in-flight 401 flag, don't mutate
// the deep-link URL scheme without updating both Rust + backend redirect.
//
// Central desktop activation bridge. ONE helper, reused by every "sign in"
// surface (FirstRun, top-nav, Earn, the 401 self-heal prompt) — no per-screen
// hacks. Flow:
//   1. generate a one-time challenge nonce,
//   2. open the browser to account.liquidclips.app/connect-desktop?challenge=…,
//   3. the page signs the user in (Clerk) and mints a license JWT server-side,
//   4. the browser deep-links back: liquidclips://activate?token=<jwt>&challenge=…,
//   5. we verify the challenge matches, store the JWT in the OS keychain via the
//      sidecar, and fire onActivated so the app flips to signed-in — no restart,
//      no JWT pasting, and only the license secret is ever touched.

// v0.7.57 — Clerk primary domain swapped to bare apex `liquidclips.app`
// (was account.jnremployee.com → briefly account.liquidclips.app satellite,
// now liquidclips.app primary). Customer auth lives at the apex via a
// marketing-edge rewrite (`liquidclips-marketing/next.config.ts`) that
// proxies /sign-in, /sign-up, /connect-desktop, /dashboard, /upgrade,
// /checkout, /api/desktop/* to the account-app project. User's URL bar
// reads liquidclips.app end-to-end; client-side Clerk JS sees
// window.location.host === "liquidclips.app" which matches the new Clerk
// primary, so the "satellite domain" error that broke v0.7.54-v0.7.56 is
// gone. Do NOT flip this back to account.jnremployee.com — the legacy
// jnremployee Clerk primary was retired at the dashboard level.
const CONNECT_URL = "https://liquidclips.app/connect-desktop";
const TIMEOUT_MS = 5 * 60_000; // generous — sign-up in the browser can take a while

export type ActivationStatus =
  | { kind: "idle" }
  | { kind: "opening" } // launching the browser
  | { kind: "waiting" } // browser open, awaiting the deep link back
  | { kind: "activating" } // deep link received, writing the license
  | { kind: "done" }
  | { kind: "error"; message: string };

let status: ActivationStatus = { kind: "idle" };
const listeners = new Set<(s: ActivationStatus) => void>();
function emit(next: ActivationStatus): void {
  status = next;
  for (const l of listeners) l(next);
}

let pendingChallenge: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let onActivated: (() => void) | null = null;
let listenerReady: Promise<unknown> | null = null;

/** App-level success hook: flip signedIn, clear needsActivation, re-sync. */
export function setOnActivated(fn: (() => void) | null): void {
  onActivated = fn;
}

export function getActivationStatus(): ActivationStatus {
  return status;
}

function clearTimer(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
}

function randomChallenge(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function handleDeepLink(urls: string[]): Promise<void> {
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    // Accept both schemes during the rebrand transition: liquidclips:// is
    // the current canonical scheme, junior:// is the legacy fallback the
    // account-app emitted pre-rebrand. Either scheme + hostname=activate is
    // a valid activation link as long as the challenge matches.
    if (u.protocol !== "liquidclips:" && u.protocol !== "junior:") continue;

    // Sprint #12 — payout return hook. The account-app's /dashboard page
    // detects Stripe-Connect return / Whop affiliate sign-in completion and
    // can redirect to liquidclips://payout-return, which fires a window
    // event so AffiliateHero refetches /me/affiliate without a page reload.
    if (u.hostname === "payout-return") {
      window.dispatchEvent(
        new CustomEvent("junior:payout-updated", {
          detail: {
            source: u.searchParams.get("source") ?? "deep-link",
          },
        }),
      );
      // also reuse the existing whop-auth bus so any code listening for that
      // (EarnTab) gets a free refresh on Whop sign-in too. Write to the
      // shared replay buffer first so a tab mounted right AFTER this fires
      // still picks up the event (within 30s).
      recordWhopAuthEvent("deep-link");
      window.dispatchEvent(
        new CustomEvent("junior:whop-auth", { detail: { source: "deep-link" } }),
      );
      return;
    }

    // v0.7.5 — channel-linked deep link fires after Ayrshare's OAuth
    // completes successfully. The account-app's /channel-linked bounce
    // page hits this scheme with ?cid=<channel_id>. Pattern:
    //
    //   1. Bounce page → `liquidclips://channel-linked?cid=…`.
    //   2. We dispatch `junior:channel-linked` once with detail.channelId.
    //   3. AccountBindingChip (per workbench window) + ChannelsManager
    //      (Settings → Connections) subscribe. Each subscriber calls
    //      backend.refreshChannel(cid) + backend.listChannels(), flips
    //      the affected row to `active`, then emits a `lc:toast` via the
    //      GlobalToastHost bus ("Instagram connected as @handle" on
    //      success; "Couldn't confirm <Platform> link — try Reconnect" if
    //      the row stays `pending_link`). The 90s waiting-state timer
    //      lives on each subscriber so a stuck OAuth surfaces as
    //      "Still waiting — try Reconnect" rather than an infinite spinner.
    if (u.hostname === "channel-linked") {
      const cid = u.searchParams.get("cid") ?? u.searchParams.get("channel_id");
      window.dispatchEvent(
        new CustomEvent("junior:channel-linked", {
          detail: {
            channelId: cid,
            source: "deep-link",
          },
        }),
      );
      return;
    }

    if (u.hostname !== "activate") continue;
    if (!pendingChallenge) return; // nothing in flight — ignore stray/old links

    const token = u.searchParams.get("token");
    const challenge = u.searchParams.get("challenge");
    if (!token || !challenge || challenge !== pendingChallenge) {
      // A mismatched challenge means this link wasn't for our pending request
      // (stale tab, or tampering) — never store it.
      emit({ kind: "error", message: "That activation didn’t match this app. Try signing in again." });
      return;
    }
    try {
      emit({ kind: "activating" });
      await sidecar.secretSet("LICENSE_JWT", token);
      // v0.7.57 P0 — Connect-desktop callback is one of four explicit auth
      // actions allowed to populate the in-memory JWT cache. Priming here
      // means every passive surface (NotificationSheet, SchedulePage rail,
      // RewardClipsPanel, ScheduleQueue, InlineScheduler drawer) auto-loads
      // through getCachedLicenseJwt without re-reading the OS Keychain.
      primeLicenseJwtCache(token);
    } catch (e) {
      // Clear pendingChallenge on keychain-write failure so a retry mints a
      // FRESH challenge instead of being silently de-duped against the stale
      // one (the browser deep-link could fire again on retry and the second
      // attempt would race-match this dead challenge and stall). Also stop
      // the timeout timer — we already emitted the error.
      clearTimer();
      pendingChallenge = null;
      // v0.7.54 — surface the real reason. Pre-fix the catch swallowed the
      // sidecar error (the most common cause is a missing `keyring` Python
      // dep, which the deps-missing card should have caught — but if the
      // user skipped it, the activation looks like a generic "try again"
      // loop with no path forward). Now the error message names the cause
      // so BUG-003's "Copy diagnostics" carries something useful.
      const detail = humanError(e);
      emit({
        kind: "error",
        message: `Couldn’t save your license: ${detail || "keychain write failed"}. Try again, or reset login below.`,
      });
      return;
    }
    clearTimer();
    pendingChallenge = null;
    emit({ kind: "done" });
    onActivated?.();
    return;
  }
}

/** Register the liquidclips:// listener once. Safe to call repeatedly. */
export function initDeepLinks(): Promise<unknown> {
  if (!listenerReady) {
    listenerReady = onOpenUrl((urls) => {
      void handleDeepLink(urls);
    }).catch(() => undefined);
  }
  return listenerReady;
}

/** Kick off activation. Renders progress via the status store; resolves the
 *  flow through the deep-link listener + onActivated.
 *
 *  Default = in-app: opens the connect-desktop page inside Liquid Clips'
 *  centered Tauri auth_panel webview, so the user signs in without leaving
 *  the app. The bridge page on account-app deep-links back via
 *  `liquidclips://activate?token=…&challenge=…`; Tauri's deep-link plugin
 *  fires `onOpenUrl` whether the link is triggered from the embedded
 *  webview or the system browser, so the activation handshake still works.
 *
 *  Pass `{ via: "browser" }` to fall back to the system browser — used by
 *  the "having trouble?" rescue button if the embedded panel ever fails. */
export async function startActivation(opts?: { via?: "panel" | "browser" }): Promise<void> {
  const via = opts?.via ?? "panel";
  await initDeepLinks();
  const challenge = randomChallenge();
  pendingChallenge = challenge;
  emit({ kind: "opening" });

  const url = `${CONNECT_URL}?challenge=${encodeURIComponent(challenge)}`;
  try {
    if (via === "panel") {
      await invoke("open_auth_panel", { url });
    } else {
      await openExternal(url);
    }
  } catch {
    pendingChallenge = null;
    emit({
      kind: "error",
      message:
        via === "panel"
          ? "Couldn’t open the in-app sign-in panel. Try the browser fallback."
          : "Couldn’t open your browser. Visit account.liquidclips.app/connect-desktop to sign in.",
    });
    return;
  }

  emit({ kind: "waiting" });
  clearTimer();
  // Keep pendingChallenge alive past the timeout so a late deep link still
  // activates; a fresh attempt overwrites it with a new challenge.
  timer = setTimeout(() => {
    if (pendingChallenge === challenge && (status.kind === "waiting" || status.kind === "opening")) {
      emit({
        kind: "error",
        message:
          via === "panel"
            ? "Activation timed out. Finish sign-in in the panel, or try the browser fallback."
            : "Activation timed out. Finish sign-in in your browser, or try again.",
      });
    }
  }, TIMEOUT_MS);
}

export function resetActivation(): void {
  emit({ kind: "idle" });
}

/** v0.7.54 — BUG-003. Full "Reset login session" escape hatch for the
 *  FirstRun dead-end. Clears every piece of state that could be holding
 *  a user on the failed-sign-in screen:
 *    • the pending challenge (a stale match could fight a fresh activation),
 *    • the local LICENSE_JWT (so a partial/corrupt write doesn't keep
 *      reading back as a half-signed-in session),
 *    • the activation status (back to idle so the button reads "Sign in").
 *  Best-effort across the keychain delete — if `keyring` is missing (the
 *  exact root cause that lands users here), we still clear the in-memory
 *  state so the surface unwedges. */
// v0.7.54 P1-008 — caller-visible result so the FailedLoginRescue button
// can honestly report "Session reset" vs "Reset partial — keychain not
// reachable". Pre-fix the swallowed catch lied: the button always read
// "Session reset" even when the JWT was still on disk.
export type ResetLoginResult = { ok: true } | { ok: false; reason: string };

export async function resetLoginSession(): Promise<ResetLoginResult> {
  clearTimer();
  pendingChallenge = null;
  let keychainOk = true;
  let reason = "";
  try {
    await sidecar.secretDelete("LICENSE_JWT");
  } catch (e) {
    // sidecar / keyring unavailable. We still clear the in-memory state
    // (the JWT, if any, is now orphaned and the next activation will
    // overwrite it) but tell the caller so the UI doesn't lie.
    keychainOk = false;
    reason = humanError(e);
  }
  emit({ kind: "idle" });
  return keychainOk ? { ok: true } : { ok: false, reason };
}

/** v0.7.54 — BUG-003. Diagnostics blob the user can copy from the error
 *  card. Includes the version + the last error message we surfaced —
 *  enough to file a ticket with concrete signal, no PII, no JWT. */
export function activationDiagnostics(version: string): string {
  const errMsg = status.kind === "error" ? status.message : "(no current error)";
  return [
    `Liquid Clips v${version}`,
    `Activation status: ${status.kind}`,
    `Last error: ${errMsg}`,
    `Connect URL: ${CONNECT_URL}`,
    `Platform: ${typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)"}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join("\n");
}

/** Subscribe to activation status + trigger it. The deep-link listener is a
 *  singleton, so multiple mounted surfaces share one flow safely.
 *
 *  `activate(opts?)` defaults to the in-app sign-in panel; pass
 *  `{ via: "browser" }` for the rescue path if the embedded webview fails. */
export function useActivation(): {
  status: ActivationStatus;
  activate: (opts?: { via?: "panel" | "browser" }) => Promise<void>;
  reset: () => void;
} {
  const [s, setS] = useState<ActivationStatus>(status);
  useEffect(() => {
    listeners.add(setS);
    setS(status);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return { status: s, activate: startActivation, reset: resetActivation };
}
