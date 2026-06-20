/**
 * Tiny event bus to open/close the InformationConsole overlay
 * without needing a global state library. Used by RightRailTab
 * and DownloadFab to trigger the overlay.
 */

export const CONSOLE_OPEN = "lc:open-console";
export const CONSOLE_CLOSE = "lc:close-console";

export function openConsole(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONSOLE_OPEN));
}

export function closeConsole(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONSOLE_CLOSE));
}
