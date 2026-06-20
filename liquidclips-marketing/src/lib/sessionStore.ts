// Stateless session "store" for the acquisition funnel demo.
//
// Why stateless · the clips shown to the user are a FIXTURE. Every
// session resolves to the same 10 cards. The only per-session data is
// the id (used in the URL) and an optional URL-derived title.
//
// We sidestep the cold-start session-loss problem by encoding everything
// derivable into the id itself + a tiny cookie hint. No KV needed. No
// new service to provision. Works for 100% of visitors regardless of
// which serverless container handles the request.
//
// When the funnel becomes REAL (Stage 1+ in the scope doc), this file
// gets swapped for a real KV-backed store. Until then, stateless wins.
//
// ID format · 7-char lowercase alphanumeric (e.g. "qcw822s"). Pure
// random · no encoding overhead. URL the user pasted is held on the
// client via a `lc_funnel_url` cookie so the analysis page can show
// the right host name (`long video · YouTube` etc.) — and falls back
// gracefully if the cookie isn't present (different browser, deep
// link, etc.).

import { FIXTURE_CLIPS, type ClipEvidence } from "./fixtureClips";

export type FunnelSession = {
  id: string;
  url: string;
  sourceTitle: string;
  sourceDuration: string;
  createdAt: number;
  clips: ClipEvidence[];
};

const ID_ALPHA = "abcdefghijkmnopqrstuvwxyz23456789";
const ID_LEN = 7;
const ID_RE = /^[a-z2-9]{6,12}$/;

export function shortId(): string {
  let out = "";
  for (let i = 0; i < ID_LEN; i++) out += ID_ALPHA[Math.floor(Math.random() * ID_ALPHA.length)];
  return out;
}

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

/** Build a session object from an id + the URL the visitor pasted.
 *  Pure · no IO · safe to call from any serverless function. */
export function buildSession(id: string, url: string | null): FunnelSession {
  const safeUrl = url ?? "";
  return {
    id,
    url: safeUrl,
    sourceTitle: deriveTitleFromUrl(safeUrl),
    sourceDuration: "09:43",
    createdAt: Date.now(),
    clips: FIXTURE_CLIPS,
  };
}

function deriveTitleFromUrl(url: string): string {
  if (!url) return "long video";
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      return "long video · YouTube";
    }
    if (u.hostname.includes("tiktok.com")) return "long video · TikTok";
    if (u.hostname.includes("twitch.tv")) return "long video · Twitch";
    if (u.hostname.includes("vimeo.com")) return "long video · Vimeo";
    return `long video · ${u.hostname.replace(/^www\./, "")}`;
  } catch {
    return "long video";
  }
}
