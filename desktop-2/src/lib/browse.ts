/**
 * browse · TS contract for the native Tauri child webview.
 *
 * 2026-06-25 · added so desktop-2 can render real Whop / X / YT / Discord
 * content (sites that refuse iframe embedding via X-Frame-Options: DENY).
 * The Rust counterpart lives at `src-tauri/src/browse.rs`. Bounds are
 * caller-provided so the BrowseOverlay (centered 90vw × 88vh modal) can
 * position the webview inside its layout — no fixed right-rail squeeze.
 *
 * Lifecycle (consumed by BrowseOverlay):
 *   1. React mounts an empty webview-slot div.
 *   2. Effect measures slot.getBoundingClientRect() → calls openBrowsePanel.
 *   3. On window resize OR slot resize → updateBrowsePanelBounds.
 *   4. On overlay close → closeBrowsePanel (destroys child webview).
 *
 * Browser-preview safety: control helpers short-circuit when Tauri is absent.
 * Opening is different: it rejects so the UI renders its honest unavailable
 * state instead of labelling an empty slot as loaded.
 */

export interface BrowsePanelBounds {
  /** Logical x position inside the main window (CSS pixels). */
  x: number;
  /** Logical y position inside the main window (CSS pixels). */
  y: number;
  /** Logical width. */
  width: number;
  /** Logical height. */
  height: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeOrNoop<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  const mod = await import("@tauri-apps/api/core");
  return (await mod.invoke<T>(cmd, args)) ?? null;
}

export interface BrowseOpenOutcome {
  opened_in_app: boolean;
  system_fallback: boolean;
}

/** Open (or re-navigate) the browse panel webview at the given bounds.
 *  Commerce URLs (/checkout, /pay, /billing, /upgrade, /subscribe,
 *  /purchase, /cart) are intercepted by Rust and opened in the system
 *  browser — App Store guideline 3.1.1. */
export async function openBrowsePanel(
  url: string,
  bounds: BrowsePanelBounds,
): Promise<BrowseOpenOutcome> {
  if (!isTauriRuntime()) {
    throw new Error("The in-app browser is available in the installed desktop app.");
  }
  const outcome = await invokeOrNoop<BrowseOpenOutcome>("open_browse_panel", {
    url,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
  if (!outcome) throw new Error("The desktop browser did not return an open result.");
  return outcome;
}

/** Resize / reposition the existing webview without re-navigating. */
export async function updateBrowsePanelBounds(bounds: BrowsePanelBounds): Promise<void> {
  await invokeOrNoop<void>("update_browse_panel_bounds", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

/** Destroy the child webview. Safe to call when panel isn't open. */
export async function closeBrowsePanel(): Promise<void> {
  await invokeOrNoop<void>("close_browse_panel");
}

export async function isBrowsePanelOpen(): Promise<boolean> {
  const result = await invokeOrNoop<boolean>("is_browse_panel_open");
  return result === true;
}

export async function browseBack(): Promise<void> {
  await invokeOrNoop<void>("browse_back");
}

export async function browseForward(): Promise<void> {
  await invokeOrNoop<void>("browse_forward");
}

export async function browseReload(): Promise<void> {
  await invokeOrNoop<void>("browse_reload");
}
