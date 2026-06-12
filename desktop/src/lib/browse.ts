// ship-lens v0.7.8: E6 — added `loading` + `error` to the panel store, a 10s loading-timeout fallback, and Tauri event subscriptions for `browse_panel:loaded` / `browse_panel:error` (Rust emits not yet shipped — Settings agent owns browse.rs; until those land the timer-based fallback still keeps the panel honest).
// Browse Rewards panel — TS bridge + singleton open-state store.
//
// Rust owns the native child webview inside the main Liquid Clips window.
// React owns the controls in Earn, outside the webview's right-side bounds.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const WHOP_REWARDS_URL = "https://whop.com/discover/content-rewards/";
// v0.7.0 — Liquid Clips central community lives on Whop, embedded in the
// same Tauri child webview that already serves Browse Rewards. One identity
// (Whop), one payout trail, one community feed — no separate Discord login.
// Pointing at the chat module specifically so the first frame is the
// conversation, not the marketing landing page.
// v0.6.19 — `/<slug>/chat` returned a "Product not found" frame for our hub.
// Whop's working landing for member-facing community + chat is the joined-
// product URL. Logged-out users land on the marketplace page; logged-in
// members get the joined experience with chat / forum / announcements
// already routed in the left rail of Whop's own UI.
//
// v0.7.54 — flipped from /joined/jnremployee/ → /liquidclips/forums-…/app/.
// The jnremployee Whop community is empty / deprecated; the canonical
// destination is the LIVE forums module inside the Liquid Clips community
// (Daniel-supplied URL, 2026-06-12) so first-time users land directly in a
// commentable feed instead of the marketing landing. Every code path that
// opens "community" reads this constant — keep it single-source so the
// rebrand can't drift again.
export const WHOP_COMMUNITY_URL =
  "https://whop.com/liquidclips/forums-83fovyATgXDQpO/app/";

// --- singleton store -----------------------------------------------------
//
// v0.7.8 fix E6 — the panel now tracks a loading flag and a fallback timeout.
// React subscribers see `loading: true` from the moment `openBrowsePanel`
// resolves until either:
//   (a) Rust emits `browse_panel:loaded` (Settings agent owns the Rust
//       side — see v0.7.9 punch-list), or
//   (b) 10s elapse without a loaded event — we hard-clear `loading` and
//       BrowseRewardsPanel surfaces a "Still loading…" Reload prompt
//       instead of pretending we're still in flight forever.
// Rust-emitted errors flow through the same store via `browse_panel:error`.

type State = {
  open: boolean;
  currentUrl: string | null;
  /** v0.7.8 fix E6 — true between openBrowsePanel→loaded (or →10s timeout). */
  loading: boolean;
};
let state: State = { open: false, currentUrl: null, loading: false };
const listeners = new Set<(s: State) => void>();
function emit(next: State): void {
  state = next;
  for (const l of listeners) l(next);
}

/** v0.7.8 fix E6 — how long to wait for `browse_panel:loaded` before we
 *  give up and flip `loading` off. 10s per spec; matches the Whop pageload
 *  budget on a slow connection. */
const LOAD_TIMEOUT_MS = 10_000;
let loadTimeoutId: number | null = null;

function clearLoadTimeout(): void {
  if (loadTimeoutId !== null) {
    if (typeof window !== "undefined") window.clearTimeout(loadTimeoutId);
    loadTimeoutId = null;
  }
}

export function useBrowsePanel(): State {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

// --- Tauri command wrappers ---------------------------------------------

/**
 * Open the in-app Browse Rewards child webview. Throws on Rust-side failure
 * (panel disabled, webview crash, OS denial) rather than silently swallowing
 * — the previous behaviour stranded users with a "nothing happened" click.
 *
 * Callers MUST handle the throw, e.g.:
 *   try { await openBrowsePanel(url); }
 *   catch (e) { setError(humanError(e)); }
 *
 * TODO(callers): EarnTab + AffiliateHero + any other caller needs to wrap
 * this in a try/catch and surface the error in their local error surface.
 * We do not edit those files in this pass.
 */
export async function openBrowsePanel(url: string = WHOP_REWARDS_URL): Promise<void> {
  try {
    await invoke<void>("open_browse_panel", { url });
  } catch (e) {
    // Make sure the singleton state doesn't lie — we never opened.
    clearLoadTimeout();
    if (state.open) emit({ open: false, currentUrl: null, loading: false });
    throw e;
  }
  // v0.7.8 fix E6 — every successful open / navigate starts a fresh load
  // window. We re-arm the 10s timeout each time so a Whop campaign that
  // navigates internally still gets a fresh budget.
  clearLoadTimeout();
  emit({ open: true, currentUrl: url, loading: true });
  if (typeof window !== "undefined") {
    loadTimeoutId = window.setTimeout(() => {
      // Only clear loading if we're still on this URL — a fast follow-up
      // navigate would have already restarted the budget.
      if (state.loading) emit({ ...state, loading: false });
      loadTimeoutId = null;
      // Surface a soft signal so the panel can render "Still loading…".
      // This is NOT an error — we just gave up waiting. The webview may
      // still finish painting; we just stop pretending to know.
      _emitBrowsePanelError(
        "Still loading — try Reload if the page didn't appear.",
      );
    }, LOAD_TIMEOUT_MS);
  }
}

export async function closeBrowsePanel(): Promise<void> {
  await invoke<void>("close_browse_panel");
  clearLoadTimeout();
  emit({ open: false, currentUrl: null, loading: false });
}

export async function isBrowsePanelOpenInRust(): Promise<boolean> {
  return invoke<boolean>("is_browse_panel_open");
}

export function browseBack(): Promise<void> {
  return invoke<void>("browse_back");
}

export function browseForward(): Promise<void> {
  return invoke<void>("browse_forward");
}

export function browseReload(): Promise<void> {
  return invoke<void>("browse_reload");
}

// --- Browse-panel error event bus ---------------------------------------
//
// reconcileBrowsePanel() runs at boot and on focus changes; failing it
// silently means a broken native webview never surfaces to the user. The
// emitter below lets BrowseRewardsPanel subscribe and route the failure to
// its inline error rail.
//
// v0.7.8 fix E6 — the bus also receives the soft "Still loading…" signal
// fired by the 10s timeout in `openBrowsePanel`, so the same UI handler
// renders both "we gave up waiting" and "real error from Rust".

const _browsePanelErrorListeners = new Set<(msg: string) => void>();

export function subscribeBrowsePanelError(cb: (msg: string) => void): () => void {
  _browsePanelErrorListeners.add(cb);
  return () => {
    _browsePanelErrorListeners.delete(cb);
  };
}

function _emitBrowsePanelError(msg: string): void {
  for (const l of _browsePanelErrorListeners) {
    try {
      l(msg);
    } catch {
      /* swallow */
    }
  }
}

// --- Tauri-event bridge -------------------------------------------------
//
// v0.7.8 fix E6 — Settings agent owns `browse.rs`; we subscribe here on
// behalf of every panel mount so the loaded/error events the Settings
// agent ships flow into the singleton store without per-component wiring.
//
// Until the Rust emit lands, the listeners attach against named events
// nothing will ever fire on — that's fine, the 10s timeout in
// `openBrowsePanel` keeps loading honest in the meantime. Once the Rust
// side emits `browse_panel:loaded` (after WKWebView's `didFinishNavigation`)
// + `browse_panel:error` (load-failed + nav-cancelled), no client change
// is needed — the wiring is already here.

const BROWSE_PANEL_LOADED_EVENT = "browse_panel:loaded";
const BROWSE_PANEL_ERROR_EVENT = "browse_panel:error";

let _eventBridgeBooted = false;
let _eventBridgeUnlisten: UnlistenFn[] = [];

/** Attach the Tauri event listeners once per process. Idempotent. Called
 *  by BrowseRewardsPanel on mount; cheap enough to also be called on
 *  reconcile boot to cover the case where the panel is opened before any
 *  React tree has mounted (unlikely today, but the price is a single Set
 *  insert). */
export async function ensureBrowsePanelEventBridge(): Promise<void> {
  if (_eventBridgeBooted) return;
  _eventBridgeBooted = true;
  try {
    const onLoaded = await listen<{ url?: string } | undefined>(
      BROWSE_PANEL_LOADED_EVENT,
      () => {
        // Real "loaded" from Rust — clear the timer and flip loading off.
        clearLoadTimeout();
        if (state.loading) emit({ ...state, loading: false });
      },
    );
    const onError = await listen<{ message?: string } | string | undefined>(
      BROWSE_PANEL_ERROR_EVENT,
      (e) => {
        // Tauri can hand us either a string payload or an object with a
        // `message` field; the Rust side hasn't shipped yet so we accept
        // both shapes preemptively. We don't want a "object Object" toast
        // when the emit eventually lands with the wrong shape.
        const payload = e.payload;
        const raw =
          typeof payload === "string"
            ? payload
            : payload && typeof payload === "object" && "message" in payload
              ? String((payload as { message?: unknown }).message ?? "")
              : "";
        const msg =
          raw.trim().length > 0
            ? raw
            : "Couldn't load this page — try Reload.";
        // Stop the load timer — we now know the outcome (failure).
        clearLoadTimeout();
        if (state.loading) emit({ ...state, loading: false });
        _emitBrowsePanelError(msg);
      },
    );
    _eventBridgeUnlisten = [onLoaded, onError];
  } catch {
    // listen() rejects in non-Tauri contexts (vite preview, jsdom test
    // runs). The 10s timeout fallback still keeps the panel honest, so we
    // swallow — booted stays true to avoid retry-spam.
  }
}

/** Tear-down for the event bridge. Test / HMR escape hatch — nothing in
 *  production calls this because the listeners live for the app's lifetime. */
export function teardownBrowsePanelEventBridge(): void {
  for (const fn of _eventBridgeUnlisten) {
    try {
      fn();
    } catch {
      /* swallow */
    }
  }
  _eventBridgeUnlisten = [];
  _eventBridgeBooted = false;
}

// Reconcile React store with Rust state on app boot — covers HMR scenarios
// where React state resets but the native webview is still attached.
export async function reconcileBrowsePanel(): Promise<void> {
  try {
    const open = await isBrowsePanelOpenInRust();
    if (open !== state.open) {
      // v0.7.8 fix E6 — reconcile can never claim "still loading" because
      // the Rust side has been alive long enough for the React tree to ask;
      // any in-flight load timer is stale.
      clearLoadTimeout();
      emit({ open, currentUrl: open ? state.currentUrl : null, loading: false });
    }
  } catch (e) {
    // Pre-boot rejections (Rust not ready) are expected — but a sustained
    // failure is a real bug we want to see. Emit lazily; subscribers (if
    // any) decide whether to toast. We still don't throw here — boot must
    // never fail just because reconcile couldn't reach Rust.
    const raw = e instanceof Error ? e.message : String(e);
    if (raw && !/not\s+(ready|initialized)|invoke\s+failed/i.test(raw)) {
      _emitBrowsePanelError(raw);
    }
  }
}
