/**
 * j005-upload · portalUrlContract
 *
 * The URL host allowlist that UploadPortal.tsx accepts (per IG-001).
 * Mirrored here as a Doctor-observable contract so a regression
 * cannot land inside UploadPortal without a test failing on this
 * side.
 *
 * If this file ever drifts from
 * `desktop-2/src/design-os/engine/UploadPortal.tsx::SUPPORTED_URL_HOSTS`,
 * that IS the regression — the two are meant to stay byte-identical.
 * Iron gate IG-001 owns the portal-side contract; this contract file
 * is the j005 mirror consumers can grep against without importing
 * the whole portal module.
 */

export const SUPPORTED_URL_HOSTS: readonly RegExp[] = [
  /(^|\.)youtube\.com$/i,
  /^youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /^vm\.tiktok\.com$/i,
  /^vt\.tiktok\.com$/i,
  /(^|\.)instagram\.com$/i,
  /^instagr\.am$/i,
  /^ig\.me$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)facebook\.com$/i,
  /^fb\.watch$/i,
  /(^|\.)vimeo\.com$/i,
  /^player\.vimeo\.com$/i,
  /(^|\.)reddit\.com$/i,
] as const;

export function isSupportedPortalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return SUPPORTED_URL_HOSTS.some((rx) => rx.test(url.hostname));
}
