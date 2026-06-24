/**
 * Tiny isomorphic OS detector for the marketing surface.
 *
 * Returns a coarse OS family — `"mac" | "windows" | "linux" | "unknown"`.
 * SSR / no-JS callers get `"unknown"` and should render a generic CTA
 * (e.g. "Download free"); client-side hydration upgrades it.
 *
 * NOTE on duplication: `components/DownloadCTA.tsx` has its own
 * finer-grained detector that distinguishes Apple Silicon vs Intel via
 * WebGL renderer probing. That file is the canonical asset-router and is
 * LOCKED by Sprint C scope (we do not modify it from this sprint). This
 * helper is the lightweight label-only detector for the hero pill +
 * trust strip. If the two ever need to merge, lift this one into
 * DownloadCTA.tsx, not the other way around.
 */

export type DetectedOS = "mac" | "windows" | "linux" | "unknown";

export function detectPlatform(): DetectedOS {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unknown";
  }
  const ua = navigator.userAgent || "";
  const plat =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    "";
  if (/Mac/.test(plat) || /Mac OS X|Macintosh|iPad|iPhone/.test(ua)) return "mac";
  if (/Win/.test(plat) || /Windows/.test(ua)) return "windows";
  if (/Linux|X11/.test(plat) || /Linux/.test(ua)) return "linux";
  return "unknown";
}

/** Human-readable OS label for the Download free pill suffix. */
export function osDisplayName(os: DetectedOS): string {
  switch (os) {
    case "mac":
      return "Mac";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return "";
  }
}
