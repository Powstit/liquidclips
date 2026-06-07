// SURFACE: Earn panel TS bridge
// MAP TAGS: (O #5)(O #6)(O #7) hosted Earn surface
// See docs/UI_MAP_embed_surfaces.md — the contract.
//
// Thin wrapper around the Rust earn_panel commands. Mirrors browse.ts's
// shape: open / close / resize + an event-listener helper for the embed-
// to-desktop bridge messages.
//
// The Rust side owns the native child webview. React owns the rectangle
// it should occupy (measured via ResizeObserver in EarnPanelMount) and
// the response to lc:auth-request (uses the existing sidecar.licenseJwtRead
// bridge — keychain access lives in the Python sidecar today).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type EarnPanelRect = { x: number; y: number; w: number; h: number };

export type EarnPanelMessage =
  | { type: "lc:nav"; to?: string }
  | { type: "lc:start-bounty"; id?: string }
  | { type: "lc:auth-request" }
  | { type: string; [k: string]: unknown };

// --- Tauri command wrappers ---------------------------------------------

/**
 * Open the Earn embed child webview. The Rust side reads
 * LIQUIDCLIPS_EMBED_BASE (or falls back to prod) for the URL — the TS
 * side doesn't need to know which environment it's on. Subsequent calls
 * surface the existing webview rather than re-opening.
 */
export async function openEarnPanel(): Promise<void> {
  await invoke<void>("open_earn_panel");
}

export async function closeEarnPanel(): Promise<void> {
  await invoke<void>("close_earn_panel");
}

/**
 * Pin the webview to the rectangle React measured. Called once on first
 * mount and again every time the container's ResizeObserver fires.
 *
 * Cheap on the Rust side (set_position + set_size); safe to call on every
 * resize tick.
 */
export async function resizeEarnPanel(rect: EarnPanelRect): Promise<void> {
  await invoke<void>("resize_earn_panel", rect);
}

export async function isEarnPanelOpenInRust(): Promise<boolean> {
  return invoke<boolean>("is_earn_panel_open");
}

/**
 * Inject a payload into the embed (window.postMessage from desktop into
 * the webview's window). Used to respond to lc:auth-request with the
 * JWT + tier the embed needs to seed its in-memory auth store.
 */
export async function postToEarnPanel(
  payload: Record<string, unknown>,
): Promise<void> {
  await invoke<void>("post_to_earn_panel", { payload });
}

// --- Event subscriptions ------------------------------------------------

/**
 * Subscribe to all embed-side messages routed through the bridge.
 *
 * Rust emits three named events plus a catch-all:
 *   earn-panel:nav            — lc:nav (route the desktop view stack)
 *   earn-panel:start-bounty   — lc:start-bounty (id?: string) → workspace
 *   earn-panel:auth-request   — lc:auth-request (respond via postToEarnPanel)
 *   earn-panel:message        — anything else with type === "lc:*"
 *
 * Returns an unsubscribe function that detaches all four listeners.
 */
export async function onEarnPanelMessage(
  callback: (msg: EarnPanelMessage) => void,
): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = await Promise.all([
    listen<EarnPanelMessage>("earn-panel:nav", (e) => callback(e.payload)),
    listen<EarnPanelMessage>("earn-panel:start-bounty", (e) => callback(e.payload)),
    listen<EarnPanelMessage>("earn-panel:auth-request", (e) => callback(e.payload)),
    listen<EarnPanelMessage>("earn-panel:message", (e) => callback(e.payload)),
  ]);
  return () => {
    for (const fn of unlisteners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * Subscribe only to the embed signalling that its first paint finished —
 * useful if the mount wants to fade in once content is on screen rather
 * than the moment Rust hands the webview to the OS compositor.
 */
export async function onEarnPanelLoaded(
  callback: () => void,
): Promise<UnlistenFn> {
  return listen("earn-panel:loaded", () => callback());
}
