import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { sidecar } from "./sidecar";
import { recordWhopAuthEvent } from "./whop-iframe";

// Central desktop activation bridge. ONE helper, reused by every "sign in"
// surface (FirstRun, top-nav, Earn, the 401 self-heal prompt) — no per-screen
// hacks. Flow:
//   1. generate a one-time challenge nonce,
//   2. open the browser to account.jnremployee.com/connect-desktop?challenge=…,
//   3. the page signs the user in (Clerk) and mints a license JWT server-side,
//   4. the browser deep-links back: liquidclips://activate?token=<jwt>&challenge=…,
//   5. we verify the challenge matches, store the JWT in the OS keychain via the
//      sidecar, and fire onActivated so the app flips to signed-in — no restart,
//      no JWT pasting, and only the license secret is ever touched.

const CONNECT_URL = "https://account.jnremployee.com/connect-desktop";
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
    } catch {
      // Clear pendingChallenge on keychain-write failure so a retry mints a
      // FRESH challenge instead of being silently de-duped against the stale
      // one (the browser deep-link could fire again on retry and the second
      // attempt would race-match this dead challenge and stall). Also stop
      // the timeout timer — we already emitted the error.
      clearTimer();
      pendingChallenge = null;
      emit({ kind: "error", message: "Couldn’t save your license. Try again." });
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
          : "Couldn’t open your browser. Visit account.jnremployee.com/connect-desktop to sign in.",
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
