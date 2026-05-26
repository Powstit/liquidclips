// Extract every plausible source-video URL from a bounty brief.
//
// Why this exists: Whop's public-graphql doesn't give a desktop app access to
// the bounty's hosted discussion-post (where the brand often embeds the source
// video). The fallback creators already use is: paste the source URL inline in
// the brief description. So we mine the description, classify each hit as
// "Junior can ingest this" or "not — open it in the browser instead", and let
// the UI render one chip per hit. The clipper never has to copy/paste a URL by
// hand for the common case.
//
// Two-tier model:
//   supported = true   → we have a yt-dlp/host-specific path. Click → ingest.
//   supported = false  → asset-host link (Drive, Dropbox, WeTransfer, bare
//                         .mp4 on an unknown CDN). Click → open in browser, the
//                         clipper downloads + drags the file into Junior. Better
//                         than pretending we can't see it.
//
// Keep the regex narrow enough that a tracker link or a Whop dashboard URL in
// the brief doesn't get surfaced as a source.
import { isSupportedSourceUrl } from "./sourceHosts";

export type DetectedSource = {
  url: string;
  /** Lowercase hostname (e.g. "youtube.com", "drive.google.com"). */
  host: string;
  /** Pretty label for the chip — "YouTube", "Google Drive", "Direct MP4", ... */
  label: string;
  /** Whether Junior's sidecar can ingest this URL directly. */
  supported: boolean;
};

// Hosts we recognise as "video asset host" even when the sidecar can't fetch
// them directly. Listing them here means the chip says "Google Drive" instead
// of just dumping the raw URL — and we won't mistake them for trackers.
const ASSET_HOSTS: { rx: RegExp; label: string }[] = [
  { rx: /(^|\.)youtube\.com$/i, label: "YouTube" },
  { rx: /^youtu\.be$/i, label: "YouTube" },
  { rx: /(^|\.)tiktok\.com$/i, label: "TikTok" },
  { rx: /^vm\.tiktok\.com$/i, label: "TikTok" },
  { rx: /(^|\.)instagram\.com$/i, label: "Instagram" },
  { rx: /(^|\.)vimeo\.com$/i, label: "Vimeo" },
  { rx: /^player\.vimeo\.com$/i, label: "Vimeo" },
  { rx: /(^|\.)x\.com$/i, label: "X" },
  { rx: /(^|\.)twitter\.com$/i, label: "Twitter" },
  { rx: /(^|\.)twitch\.tv$/i, label: "Twitch" },
  { rx: /(^|\.)streamable\.com$/i, label: "Streamable" },
  { rx: /(^|\.)drive\.google\.com$/i, label: "Google Drive" },
  { rx: /(^|\.)docs\.google\.com$/i, label: "Google Drive" },
  { rx: /(^|\.)dropbox\.com$/i, label: "Dropbox" },
  { rx: /^we\.tl$/i, label: "WeTransfer" },
  { rx: /(^|\.)wetransfer\.com$/i, label: "WeTransfer" },
  { rx: /(^|\.)icloud\.com$/i, label: "iCloud" },
  { rx: /(^|\.)mega\.nz$/i, label: "MEGA" },
  { rx: /(^|\.)box\.com$/i, label: "Box" },
];

// Catches https?:// URLs ending at whitespace, common punctuation, or a closing
// bracket. We strip trailing sentence punctuation after matching.
const URL_RX = /https?:\/\/[^\s)\]<>"']+/gi;

// Bare-media extensions on any host. If we see one of these we still surface
// it (labelled "Direct video file"), even when the host isn't in ASSET_HOSTS.
const DIRECT_MEDIA_RX = /\.(mp4|mov|m4v|mkv|webm|avi)(\?|#|$)/i;

function classify(rawUrl: string): DetectedSource | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.toLowerCase();

  const knownAsset = ASSET_HOSTS.find((h) => h.rx.test(host));
  if (knownAsset) {
    return {
      url: rawUrl,
      host,
      label: knownAsset.label,
      supported: isSupportedSourceUrl(rawUrl),
    };
  }

  if (DIRECT_MEDIA_RX.test(url.pathname)) {
    return {
      url: rawUrl,
      host,
      label: "Direct video file",
      supported: false, // sidecar's yt-dlp path is host-keyed, not extension-keyed
    };
  }

  return null;
}

export function extractSourceUrls(
  description: string | null | undefined,
): DetectedSource[] {
  if (!description) return [];
  const matches = description.match(URL_RX) ?? [];
  const seen = new Set<string>();
  const out: DetectedSource[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?]+$/, "");
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    const hit = classify(cleaned);
    if (hit) out.push(hit);
  }
  // Supported hits first — that's the click clippers want to make.
  out.sort((a, b) => Number(b.supported) - Number(a.supported));
  return out;
}

/**
 * Back-compat single-URL helper: the first supported URL, else the first
 * recognised URL, else null. Lets older call-sites keep working while the
 * setup screen migrates to the multi-chip API.
 */
export function firstSourceUrl(
  description: string | null | undefined,
): string | null {
  const all = extractSourceUrls(description);
  if (all.length === 0) return null;
  return all[0].url;
}
