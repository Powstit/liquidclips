// Hosts Junior knows how to ingest via yt-dlp. We validate URLs against this
// allowlist BEFORE handing them to the sidecar so a stray paste (a Whop bounty
// page, an analytics tracker, an arbitrary http://) can't trigger a remote
// fetch we don't support and can't end up in our progress UI as a half-failed
// run. The list is intentionally narrow — adding a host is one line, but the
// default is "say no clearly" rather than "try anything".

const SUPPORTED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)youtube\.com$/i,
  /^youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /^vm\.tiktok\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)vimeo\.com$/i,
  /^player\.vimeo\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
];

export function isSupportedSourceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;
  return SUPPORTED_HOST_PATTERNS.some((rx) => rx.test(url.hostname));
}
