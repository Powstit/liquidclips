// ship-lens v0.7.7: fix #10 — desktop pushes my-whop-submission IDs via the auth-jwt reply so the embed's status pills stop being silently empty
// SURFACE: embed auth helper
// MAP TAGS: (O #7 — proof of identity) — every embed surface relies on this
// to know "who is the desktop user" before fetching tier-gated data.
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// Two data sources, in priority order:
//   1. Clerk server-side cookie via `auth()` (preferred — same path /dashboard
//      uses, verified working on the satellite domain). The embed page reads
//      `userId` server-side and hydrates the EmbedAuthBridge with it.
//   2. post-message bridge for the LICENSE_JWT — needed only for the small
//      number of backend routes that require a license-bearer token instead
//      of the Clerk session cookie (e.g. `/whop/bounties`). The desktop
//      parent answers `lc:auth-request` with `lc:auth-jwt`.
//
// The tier union mirrors the desktop's `useTier()` return type (legacy aliases
// included so the embed page can render whatever the backend hands back).

export type EmbedTier =
  | "free"
  | "solo"
  | "pro"
  | "agency"
  | "growth"
  | "channel"
  | "autopilot"
  | null;

export type EmbedAuthState = {
  /** Clerk userId from server-side auth() (null when not signed in). */
  userId: string | null;
  /** Resolved tier. Server-rendered from /affiliate/me when available,
   *  otherwise refined client-side by the post-message reply. */
  tier: EmbedTier;
  /** License JWT — only present when the desktop parent has replied to a
   *  `lc:auth-request` postMessage. Used for client-side calls to
   *  /whop/bounties and friends. */
  jwt: string | null;
  /** Submission IDs the desktop remembers from past Whop posts. The desktop
   *  owns this list (its `rememberSubmissionId` writes to
   *  `localStorage["junior:my-whop-submissions:v1"]`); the webview is a
   *  different origin and can't read that key directly. Path A from
   *  v0.7.7 fix #10: the desktop ships the list in the `lc:auth-jwt`
   *  reply, and SubmissionStatusIsland polls from here instead of
   *  reading its own localStorage (which would always be empty because
   *  the embed origin never wrote anything to it). */
  submissionIds: string[];
};

export const EMBED_AUTH_DEFAULT: EmbedAuthState = {
  userId: null,
  tier: null,
  jwt: null,
  submissionIds: [],
};

// Message protocol — kept tiny on purpose so the desktop parent can mirror it
// without a shared package. Anything that's not a string is dropped on the
// receive side; window.parent posts to `*` because the parent frame's origin
// is `tauri://localhost` which isn't a real CORS origin we can match against.

export const EMBED_MSG = {
  /** Webview → desktop: "tell me who I am, give me a JWT". */
  AUTH_REQUEST: "lc:auth-request",
  /** Desktop → webview: "here's the JWT + the tier we resolved." */
  AUTH_JWT: "lc:auth-jwt",
  /** Webview → desktop: open this campaign natively (don't load it in the iframe). */
  NAV_CAMPAIGN: "lc:nav",
  /** Webview → desktop: jump to Workspace with this bounty id pre-loaded. */
  START_BOUNTY: "lc:start-bounty",
} as const;

export type EmbedAuthMessage =
  | { type: typeof EMBED_MSG.AUTH_REQUEST }
  | {
      type: typeof EMBED_MSG.AUTH_JWT;
      value: string;
      tier?: EmbedTier;
      /** Submission IDs the desktop tracks via `rememberSubmissionId`.
       *  Optional because older desktop builds (pre-v0.7.7) don't ship
       *  this field — embed degrades to an empty list, no crash. */
      submissionIds?: string[];
    };

/** Production backend — same URL the account-app dashboard already calls.
 *  api.jnremployee.com is the canonical custom domain on Railway; the desktop
 *  also uses it from `desktop/src/lib/backend.ts`. */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

/** Normalize whatever tier label the backend hands back into the union the
 *  carousel / bounty list gates on. Legacy aliases collapse to their v2 names. */
export function normalizeTier(raw: string | null | undefined): EmbedTier {
  if (!raw) return null;
  if (raw === "growth" || raw === "channel") return "pro";
  if (raw === "autopilot") return "agency";
  if (
    raw === "free" ||
    raw === "solo" ||
    raw === "pro" ||
    raw === "agency"
  ) {
    return raw;
  }
  return null;
}
