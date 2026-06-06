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

export async function openBrowsePanel(url: string = WHOP_REWARDS_URL): Promise<void> {
  await invoke<void>("open_browse_panel", { url });
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

// Reconcile React store with Rust state on app boot — covers HMR scenarios
// where React state resets but the native webview is still attached.
export async function reconcileBrowsePanel(): Promise<void> {
  try {
    const open = await isBrowsePanelOpenInRust();
    if (open !== state.open) {
      emit({ open, currentUrl: open ? state.currentUrl : null });
    }
  } catch {
    /* ignore — pre-boot or sidecar/rust not ready */
  }
}
