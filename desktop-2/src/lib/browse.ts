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

/**
 * G2 · Layer 5 (2026-07-04) · the Rust side now returns explicit
 * "panel missing" errors instead of silently succeeding when the
 * child webview isn't there. For commands where missing == "no-op /
 * already done" (close · update-bounds), suppress the specific
 * error string to preserve the documented "safe to call when panel
 * isn't open" contract. For commands where missing == "operation
 * was meaningful, user should know" (back · forward · reload ·
 * webview_eval), the error bubbles so callers can subscribe to the
 * `browse:crashed` Tauri event and reset their UI.
 */
function isPanelMissing(err: unknown): boolean {
  if (typeof err === "string") return err === "panel missing";
  if (err instanceof Error) return err.message === "panel missing";
  return false;
}

/** Resize / reposition the existing webview without re-navigating.
 *  Silently succeeds if the panel isn't open (documented contract). */
export async function updateBrowsePanelBounds(bounds: BrowsePanelBounds): Promise<void> {
  try {
    await invokeOrNoop<void>("update_browse_panel_bounds", {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  } catch (err) {
    if (!isPanelMissing(err)) throw err;
    // Panel missing → no-op; the Rust side already emitted
    // `browse:crashed` for any listener that cares.
  }
}

/** Destroy the child webview. Safe to call when panel isn't open. */
export async function closeBrowsePanel(): Promise<void> {
  try {
    await invokeOrNoop<void>("close_browse_panel");
  } catch (err) {
    if (!isPanelMissing(err)) throw err;
  }
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

/**
 * G2 · Layer 5 (2026-07-04) · canonical crash-detection primitive.
 *
 * Returns:
 *   `"responsive"`   — panel exists AND accepted a no-op eval
 *   `"unresponsive"` — panel exists BUT the wry runtime is dead
 *   `"missing"`      — panel handle gone entirely
 *
 * The Rust command emits the `browse:crashed` Tauri event on the
 * `"unresponsive"` and `"missing"` branches, so a react component
 * that cares about the panel's state should listen for the event
 * AND call this method opportunistically when regaining focus.
 */
export type BrowseHealthStatus = "responsive" | "unresponsive" | "missing";

export interface BrowseHealthReport {
  status: BrowseHealthStatus;
}

export async function browseHealthCheck(): Promise<BrowseHealthReport | null> {
  return invokeOrNoop<BrowseHealthReport>("browse_health_check");
}

/**
 * Tauri event name emitted by browse.rs on every child-webview navigation.
 * Payload is the destination URL as a string. Kept in sync with the Rust
 * constant `URL_CHANGED_EVENT` in src-tauri/src/browse.rs.
 */
export const BROWSE_URL_CHANGED_EVENT = "browse:url-changed";

/**
 * Subscribe to child-webview URL changes. Returns an unsubscribe fn.
 *
 * Silently no-ops in browser preview (no Tauri runtime) — the returned
 * unsubscribe fn is safe to call regardless. Every navigation attempt
 * fires, including commerce URLs that get bounced to the system
 * browser; callers filter what they care about.
 *
 * Callers today:
 *   • BrowseOverlay — keeps `currentUrl` + address bar in sync with
 *     real webview location (was Phase 2 TODO).
 *   • whopBountyCapture — auto-detects Whop bounty URLs so the
 *     agency's Post-to-Whop flow completes without a manual copy-paste.
 */
export async function subscribeBrowseUrlChanges(
  cb: (url: string) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => { /* noop */ };
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>(BROWSE_URL_CHANGED_EVENT, (evt) => {
      if (typeof evt.payload === "string" && evt.payload.length > 0) {
        cb(evt.payload);
      }
    });
    return unlisten;
  } catch {
    return () => { /* noop — event API unavailable */ };
  }
}
