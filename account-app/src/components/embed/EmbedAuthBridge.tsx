"use client";

// ship-lens v0.7.8: fix E1 — added 4s stall timer + manual retry. When `userId` is set but no `lc:auth-jwt` reply lands within 4s we flip `authStatus` to "stalled" so BountyList renders an honest "couldn't reach desktop" panel instead of skeletons forever.
// ship-lens v0.7.7: fix #10 — bridge now relays desktop-pushed submissionIds into context (sessionStorage cache only; desktop owns truth)
// SURFACE: embed auth bridge (client)
// MAP TAGS: (O #7 — proof of identity)
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// Wraps every page under /embed/* so child components can call useEmbedAuth()
// and get a single { userId, tier, jwt } shape regardless of how the data
// arrived.
//
// Two intake paths run in parallel:
//   1. The server already resolved Clerk's userId + tier and passed them down
//      as initial props. That's the steady-state path inside the Tauri
//      webview: the Clerk satellite cookie crosses the frame boundary because
//      `account.liquidclips.app` is the same origin both the desktop window
//      and child webview point at.
//   2. We still postMessage `lc:auth-request` to the parent on mount because:
//        (a) the parent may answer with a freshly-rotated LICENSE_JWT we need
//            for `/whop/bounties` (license-bearer only, no Clerk path);
//        (b) if the satellite cookie ever fails to hop the webview boundary,
//            this is the fallback that keeps tier-gating honest.
//
// Storage:
//   • JWT — in-memory React context only. Never write the JWT to localStorage;
//     the desktop parent owns the keychain copy.
//   • submissionIds — in-memory context PLUS a sessionStorage echo at
//     `lc:embed:my-whop-submissions:v1` so a webview tab refresh doesn't blank
//     the status pills before the next `lc:auth-jwt` arrives. The desktop's
//     `localStorage["junior:my-whop-submissions:v1"]` stays the source of
//     truth; the sessionStorage echo is a UX smoother, never authoritative.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  EMBED_AUTH_DEFAULT,
  EMBED_MSG,
  normalizeTier,
  type EmbedAuthState,
  type EmbedAuthStatus,
  type EmbedAuthMessage,
  type EmbedTier,
} from "@/lib/embed-auth";

/** v0.7.8 fix E1 — how long we wait for `lc:auth-jwt` before flipping the
 *  context's `authStatus` from "pending" to "stalled". 4s is the spec value;
 *  generous for slow boot races, short enough that the user notices.
 *  The desktop's auth-request handler in EarnPanelMount completes in <100ms
 *  steady-state, so anything over this window is a real bridge failure. */
const AUTH_REPLY_STALL_MS = 4000;

const EmbedAuthContext = createContext<EmbedAuthState>(EMBED_AUTH_DEFAULT);

export function useEmbedAuth(): EmbedAuthState {
  return useContext(EmbedAuthContext);
}

/** Canonical embed-side key for the session-cache echo of the desktop's
 *  authoritative `localStorage["junior:my-whop-submissions:v1"]`. NEVER
 *  written by anything except this bridge's response handler — Path A's
 *  whole point is that the desktop owns the list. */
const EMBED_SUBMISSION_IDS_KEY = "lc:embed:my-whop-submissions:v1";

function readCachedSubmissionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(EMBED_SUBMISSION_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function writeCachedSubmissionIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      EMBED_SUBMISSION_IDS_KEY,
      JSON.stringify(ids),
    );
  } catch {
    /* quota / private mode — non-fatal; the in-memory copy is still good */
  }
}

export function EmbedAuthBridge({
  initialUserId,
  initialTier,
  children,
}: {
  initialUserId: string | null;
  initialTier: EmbedTier;
  children: React.ReactNode;
}) {
  const [jwt, setJwt] = useState<string | null>(null);
  const [tier, setTier] = useState<EmbedTier>(initialTier);
  // Hydrate from sessionStorage so a webview tab refresh keeps showing the
  // status pills until the next `lc:auth-jwt` reply arrives (which then
  // overwrites this with the fresh authoritative list).
  const [submissionIds, setSubmissionIds] = useState<string[]>(
    readCachedSubmissionIds,
  );
  // v0.7.8 fix E1 — only mark "pending" when there's actually a user to
  // resolve. Without a userId we have no desktop session to phone home to;
  // the page sits in "idle" and BountyList renders a sign-in shell, not a
  // stall warning.
  const [authStatus, setAuthStatus] = useState<EmbedAuthStatus>(
    initialUserId ? "pending" : "idle",
  );
  /** v0.7.8 fix E1 — the 4s stall timer. Kept in a ref so the retry handler
   *  can clear+re-arm it without re-running the mount effect. */
  const stallTimerRef = useRef<number | null>(null);

  /** v0.7.8 fix E1 — Re-send `lc:auth-request` and reset the stall timer.
   *  Exposed on the context so BountyList's "Reopen Earn" retry button can
   *  call it. Safe outside an iframe — the postMessage just throws into the
   *  catch and we stay in `pending` until the timer fires. */
  const requestAuth = useCallback(() => {
    if (typeof window === "undefined") return;
    // Clear any in-flight stall countdown so a retry doesn't get out-raced
    // by the old timer.
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setAuthStatus(initialUserId ? "pending" : "idle");
    try {
      const req: EmbedAuthMessage = { type: EMBED_MSG.AUTH_REQUEST };
      window.parent.postMessage(req, "*");
    } catch {
      /* not in an iframe — degrade silently */
    }
    // Re-arm the 4s stall timer for retries too.
    if (initialUserId) {
      stallTimerRef.current = window.setTimeout(() => {
        // Only stall if the JWT still hasn't landed. The message handler
        // below clears the timer eagerly, so this fires only on real timeouts.
        setAuthStatus((prev) => (prev === "pending" ? "stalled" : prev));
        stallTimerRef.current = null;
      }, AUTH_REPLY_STALL_MS);
    }
  }, [initialUserId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onMessage(ev: MessageEvent) {
      // Accept messages from the desktop parent only. The parent frame's
      // origin in Tauri is `tauri://localhost`, so we can't strictly
      // origin-check here without bricking the embed in dev. We narrow on the
      // payload shape instead: only the well-known message types are honored,
      // everything else is dropped.
      const data = ev.data as Partial<EmbedAuthMessage> | undefined;
      if (!data || typeof data !== "object") return;
      if (data.type === EMBED_MSG.AUTH_JWT) {
        const incoming = data as Extract<
          EmbedAuthMessage,
          { type: typeof EMBED_MSG.AUTH_JWT }
        >;
        if (typeof incoming.value === "string" && incoming.value.length > 0) {
          setJwt(incoming.value);
          // v0.7.8 fix E1 — successful reply clears the stall guard.
          if (stallTimerRef.current !== null) {
            window.clearTimeout(stallTimerRef.current);
            stallTimerRef.current = null;
          }
          setAuthStatus("ok");
        }
        const t = normalizeTier(incoming.tier ?? null);
        if (t) setTier(t);
        // Desktop-pushed submission IDs. We treat the desktop's list as
        // authoritative: this reply replaces what we had cached. Filter to
        // strings defensively because the bridge is JSON over postMessage and
        // an older / malformed desktop could ship anything.
        if (Array.isArray(incoming.submissionIds)) {
          const cleaned = incoming.submissionIds.filter(
            (x): x is string => typeof x === "string",
          );
          setSubmissionIds(cleaned);
          writeCachedSubmissionIds(cleaned);
        }
      }
    }

    window.addEventListener("message", onMessage);

    // Kick the request once on mount. The desktop parent intercepts this and
    // replies with `lc:auth-jwt`. If we're loaded outside the desktop (e.g.
    // someone opens the URL in a regular browser) there's no parent listener
    // and the page silently runs on Clerk-only auth — the bounty list will
    // still render an empty / sign-in panel, never a crash.
    try {
      const req: EmbedAuthMessage = { type: EMBED_MSG.AUTH_REQUEST };
      window.parent.postMessage(req, "*");
    } catch {
      /* not in an iframe — degrade silently */
    }

    // v0.7.8 fix E1 — arm the 4s stall timer iff there's a user expecting a
    // JWT. Without `initialUserId` there's nothing to resolve and we stay in
    // "idle" (BountyList renders sign-in copy, not the stall panel).
    if (initialUserId) {
      stallTimerRef.current = window.setTimeout(() => {
        setAuthStatus((prev) => (prev === "pending" ? "stalled" : prev));
        stallTimerRef.current = null;
      }, AUTH_REPLY_STALL_MS);
    }

    return () => {
      window.removeEventListener("message", onMessage);
      if (stallTimerRef.current !== null) {
        window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
    };
  }, [initialUserId]);

  const value = useMemo<EmbedAuthState>(
    () => ({
      userId: initialUserId,
      tier,
      jwt,
      submissionIds,
      authStatus,
      requestAuth,
    }),
    [initialUserId, tier, jwt, submissionIds, authStatus, requestAuth],
  );

  return (
    <EmbedAuthContext.Provider value={value}>
      {children}
    </EmbedAuthContext.Provider>
  );
}
