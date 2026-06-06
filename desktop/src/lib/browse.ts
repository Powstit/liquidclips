// Browse Rewards panel — TS bridge + singleton open-state store.
//
// Rust owns the native child webview inside the main Liquid Clips window.
// React owns the controls in Earn, outside the webview's right-side bounds.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
export const WHOP_COMMUNITY_URL = "https://whop.com/joined/jnremployee/";

// --- singleton store -----------------------------------------------------

type State = { open: boolean; currentUrl: string | null };
let state: State = { open: false, currentUrl: null };
const listeners = new Set<(s: State) => void>();
function emit(next: State): void {
  state = next;
  for (const l of listeners) l(next);
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
    if (state.open) emit({ open: false, currentUrl: null });
    throw e;
  }
  emit({ open: true, currentUrl: url });
}

export async function closeBrowsePanel(): Promise<void> {
  await invoke<void>("close_browse_panel");
  emit({ open: false, currentUrl: null });
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
// emitter below lets App.tsx subscribe and route the failure to a toast,
// without us editing App.tsx in this pass.
//
// TODO(App.tsx): subscribe with subscribeBrowsePanelError(msg => toast(msg)).

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

// Reconcile React store with Rust state on app boot — covers HMR scenarios
// where React state resets but the native webview is still attached.
export async function reconcileBrowsePanel(): Promise<void> {
  try {
    const open = await isBrowsePanelOpenInRust();
    if (open !== state.open) {
      emit({ open, currentUrl: open ? state.currentUrl : null });
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
