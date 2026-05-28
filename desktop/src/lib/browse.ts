// Browse Rewards panel — TS bridge + singleton open-state store.
//
// The native child webview is owned by Rust (see src-tauri/src/browse.rs);
// React owns a 44px chrome bar on top (back/forward/refresh/close). State
// is hoisted out of any single component so the chrome stays mounted even
// when the user navigates away from the Earn tab that opened it.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export const WHOP_REWARDS_URL = "https://whop.com/discover/content-rewards/";

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
