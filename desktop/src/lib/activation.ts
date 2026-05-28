import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { sidecar } from "./sidecar";

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
    if (u.protocol !== "liquidclips:" || u.hostname !== "activate") continue;
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
 *  flow through the deep-link listener + onActivated. */
export async function startActivation(): Promise<void> {
  await initDeepLinks();
  const challenge = randomChallenge();
  pendingChallenge = challenge;
  emit({ kind: "opening" });

  const url = `${CONNECT_URL}?challenge=${encodeURIComponent(challenge)}`;
  try {
    await openExternal(url);
  } catch {
    pendingChallenge = null;
    emit({
      kind: "error",
      message: "Couldn’t open your browser. Visit account.jnremployee.com/connect-desktop to sign in.",
    });
    return;
  }

  emit({ kind: "waiting" });
  clearTimer();
  // Keep pendingChallenge alive past the timeout so a late deep link still
  // activates; a fresh attempt overwrites it with a new challenge.
  timer = setTimeout(() => {
    if (pendingChallenge === challenge && (status.kind === "waiting" || status.kind === "opening")) {
      emit({ kind: "error", message: "Activation timed out. Finish sign-in in your browser, or try again." });
    }
  }, TIMEOUT_MS);
}

export function resetActivation(): void {
  emit({ kind: "idle" });
}

/** Subscribe to activation status + trigger it. The deep-link listener is a
 *  singleton, so multiple mounted surfaces share one flow safely. */
export function useActivation(): { status: ActivationStatus; activate: () => Promise<void>; reset: () => void } {
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
