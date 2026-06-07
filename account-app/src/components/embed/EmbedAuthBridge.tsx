"use client";

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

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  EMBED_AUTH_DEFAULT,
  EMBED_MSG,
  normalizeTier,
  type EmbedAuthState,
  type EmbedAuthMessage,
  type EmbedTier,
} from "@/lib/embed-auth";

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

    return () => window.removeEventListener("message", onMessage);
  }, []);

  const value = useMemo<EmbedAuthState>(
    () => ({
      userId: initialUserId,
      tier,
      jwt,
      submissionIds,
    }),
    [initialUserId, tier, jwt, submissionIds],
  );

  return (
    <EmbedAuthContext.Provider value={value}>
      {children}
    </EmbedAuthContext.Provider>
  );
}
