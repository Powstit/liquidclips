// Web shim for `@tauri-apps/plugin-shell`. The desktop opens external URLs /
// files in the OS default app; in browser we just window.open() the URL and
// silently no-op on local file paths.

export async function open(target: string): Promise<void> {
  if (typeof target !== "string") return;
  if (/^https?:\/\//.test(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
  }
  // Local file paths are a no-op — there's no browser equivalent of
  // "open in Finder" or "play in QuickTime".
}
