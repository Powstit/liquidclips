/**
 * Native chat client — v2.2.10
 *
 * Owns the desktop side of /chat/* (history, post, pin/unpin, media
 * search). Tiny on purpose: a single hook (`useChatChannel`) polls
 * history, exposes a sender, and refreshes on `activation:complete`.
 *
 * Default-empty semantics are load-bearing: when /chat/messages is
 * unreachable or returns 401 (no JWT yet), the hook returns an empty
 * list + can_write=false. The ChatPanel renders a quiet empty state so
 * the pinned Workstation visual baseline (panel closed) never drifts.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getJwt } from "./authStorage";
import { useEvent } from "../design-os/bridge";

export type ChatChannel = "global" | "agency-vip";
export type ChatRole = "founder" | "staff" | "mod" | "bot" | "member";
export type PinSeverity = "info" | "warning" | "critical";

export interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  channel: ChatChannel;
  content: string;
  role: ChatRole;
  pinned: boolean;
  announcement_id: string | null;
  created_at: string;
  /** v2.2.11 arcade · author's best-ever Space Invaders score at fetch
   *  time. 0 = no record / no badge rendered. */
  arcade_high_score: number;
}

export interface ArcadeLeaderboardEntry {
  user_id: string;
  username: string;
  arcade_high_score: number;
  role: ChatRole;
}

export interface ChatHistory {
  channel: ChatChannel;
  messages: ChatMessage[];
  can_write: boolean;
  viewer_role: ChatRole;
}

export type ChatConnectionState =
  | "idle"
  | "loading"
  | "ready"
  | "forbidden"
  | "offline"
  | "error";

export interface ChatHistoryResult {
  history: ChatHistory;
  state: Exclude<ChatConnectionState, "idle" | "loading">;
  error: string | null;
}

export interface MediaResult {
  id: string;
  preview_url: string;
  full_url: string;
  title: string | null;
}

export type MediaProvider = "giphy" | "pexels";

function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

function authHeader(): Record<string, string> {
  const jwt = getJwt();
  return jwt ? { authorization: `Bearer ${jwt}` } : {};
}

const EMPTY_HISTORY: ChatHistory = {
  channel: "global",
  messages: [],
  can_write: false,
  viewer_role: "member",
};

export async function fetchChatHistory(
  channel: ChatChannel,
): Promise<ChatHistory> {
  return (await fetchChatHistoryResult(channel)).history;
}

export async function fetchChatHistoryResult(
  channel: ChatChannel,
): Promise<ChatHistoryResult> {
  const jwt = getJwt();
  if (!jwt) {
    return {
      history: { ...EMPTY_HISTORY, channel },
      state: "forbidden",
      error: "Sign in to load Community chat.",
    };
  }
  try {
    const r = await fetch(
      `${lcBackendUrl()}/chat/messages?channel=${encodeURIComponent(channel)}`,
      { cache: "no-store", headers: authHeader() },
    );
    if (r.status === 401 || r.status === 403) {
      return {
        history: { ...EMPTY_HISTORY, channel },
        state: "forbidden",
        error: channel === "agency-vip"
          ? "Agency access is required for this room."
          : "Your session cannot access Community chat.",
      };
    }
    if (!r.ok) {
      return {
        history: { ...EMPTY_HISTORY, channel },
        state: "error",
        error: `Chat history returned ${r.status}.`,
      };
    }
    const data = (await r.json()) as ChatHistory;
    const history = data && Array.isArray(data.messages)
      ? data
      : { ...EMPTY_HISTORY, channel };
    return { history, state: "ready", error: null };
  } catch {
    return {
      history: { ...EMPTY_HISTORY, channel },
      state: "offline",
      error: "Community chat is offline. Check your connection and retry.",
    };
  }
}

export interface SendOpts {
  channel: ChatChannel;
  content: string;
  pinned?: boolean;
  pinSeverity?: PinSeverity;
}

export async function sendChatMessage(
  opts: SendOpts,
): Promise<ChatMessage | null> {
  return (await sendChatMessageDetailed(opts)).message;
}

export interface SendChatResult {
  message: ChatMessage | null;
  error: string | null;
  status: number | null;
}

export async function sendChatMessageDetailed(
  opts: SendOpts,
): Promise<SendChatResult> {
  const jwt = getJwt();
  if (!jwt) return { message: null, error: "Sign in to send messages.", status: 401 };
  try {
    const r = await fetch(`${lcBackendUrl()}/chat/message`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...authHeader(),
      },
      body: JSON.stringify({
        channel: opts.channel,
        content: opts.content,
        pinned: opts.pinned === true,
        pin_severity: opts.pinSeverity ?? "info",
      }),
    });
    if (!r.ok) {
      return {
        message: null,
        error: r.status === 403
          ? "This room is read-only for your account."
          : `Message could not be sent (${r.status}).`,
        status: r.status,
      };
    }
    const data = (await r.json()) as { message: ChatMessage };
    return {
      message: data?.message ?? null,
      error: data?.message ? null : "The server did not return the sent message.",
      status: r.status,
    };
  } catch {
    return {
      message: null,
      error: "Message not sent. Community chat is offline.",
      status: null,
    };
  }
}

export async function unpinChatMessage(messageId: string): Promise<boolean> {
  const jwt = getJwt();
  if (!jwt) return false;
  try {
    const r = await fetch(
      `${lcBackendUrl()}/chat/message/${encodeURIComponent(messageId)}/pin`,
      { method: "DELETE", cache: "no-store", headers: authHeader() },
    );
    return r.ok;
  } catch {
    return false;
  }
}

export interface MediaSearchResult {
  provider: MediaProvider;
  results: MediaResult[];
  /** Set when the backend returned 503 setup_required — the picker
   *  surfaces a "Configure {KEY} in env" hint instead of an empty grid. */
  setupRequired: boolean;
  /** Human-readable transport/server failure. Empty-result searches are not
   * errors and therefore leave this null. */
  error: string | null;
}

/** v2.2.11 arcade · ratchet the caller's best Space Invaders score on
 *  the server. Returns the resolved value + whether this submission
 *  moved the record up. Best-effort — silently no-ops without a JWT
 *  so the existing local-only highScore.ts write still lands offline. */
export async function submitArcadeScore(score: number): Promise<{
  arcade_high_score: number;
  updated: boolean;
} | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const r = await fetch(`${lcBackendUrl()}/chat/game/score`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...authHeader(),
      },
      body: JSON.stringify({ score: Math.max(0, Math.floor(score)) }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      arcade_high_score: number;
      updated: boolean;
    };
    return data;
  } catch {
    return null;
  }
}

/** v2.2.11 · share the caller's arcade score into #global-lounge as
 *  a system-bot row. Backend clamps the cited score upward to the
 *  persisted record so a sad replay can't over-shout. Returns true on
 *  HTTP 2xx. */
export async function shareArcadeScore(score: number): Promise<boolean> {
  const jwt = getJwt();
  if (!jwt) return false;
  try {
    const r = await fetch(`${lcBackendUrl()}/chat/game/share`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...authHeader(),
      },
      body: JSON.stringify({ score: Math.max(0, Math.floor(score)) }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function fetchArcadeLeaderboard(
  limit = 10,
): Promise<ArcadeLeaderboardEntry[]> {
  const jwt = getJwt();
  if (!jwt) return [];
  try {
    const r = await fetch(
      `${lcBackendUrl()}/chat/game/leaderboard?limit=${limit}`,
      { cache: "no-store", headers: authHeader() },
    );
    if (!r.ok) return [];
    const data = (await r.json()) as { entries: ArcadeLeaderboardEntry[] };
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

export async function searchMedia(
  provider: MediaProvider,
  q: string,
): Promise<MediaSearchResult> {
  const empty: MediaSearchResult = {
    provider,
    results: [],
    setupRequired: false,
    error: null,
  };
  const jwt = getJwt();
  if (!jwt || q.trim().length === 0) return empty;
  try {
    const r = await fetch(
      `${lcBackendUrl()}/chat/media/${provider}?q=${encodeURIComponent(q)}`,
      { cache: "no-store", headers: authHeader() },
    );
    if (r.status === 503) {
      return { ...empty, setupRequired: true };
    }
    if (!r.ok) {
      return {
        ...empty,
        error: `Media search returned ${r.status}.`,
      };
    }
    const data = (await r.json()) as { provider: MediaProvider; results: MediaResult[] };
    return {
      provider,
      results: Array.isArray(data?.results) ? data.results : [],
      setupRequired: false,
      error: null,
    };
  } catch {
    return {
      ...empty,
      error: "Media search is offline. Check your connection and retry.",
    };
  }
}

/** Poll-on-mount + refresh-on-activation hook. No websocket in v1 — a
 *  10-second poll keeps /sync + /chat traffic patterns identical and
 *  avoids the connection-management cliff. */
const POLL_INTERVAL_MS = 10_000;

export function useChatChannel(
  channel: ChatChannel,
  options: { enabled: boolean },
): {
  history: ChatHistory;
  reload: () => Promise<void>;
  isLoading: boolean;
  state: ChatConnectionState;
  error: string | null;
} {
  const [history, setHistory] = useState<ChatHistory>({
    ...EMPTY_HISTORY,
    channel,
  });
  const [isLoading, setLoading] = useState(false);
  const [state, setState] = useState<ChatConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const reload = useCallback(async () => {
    if (!options.enabled) return;
    setLoading(true);
    setState((current) => current === "idle" ? "loading" : current);
    const result = await fetchChatHistoryResult(channel);
    if (!cancelled.current) {
      setHistory(result.history);
      setState(result.state);
      setError(result.error);
      setLoading(false);
    }
  }, [channel, options.enabled]);

  useEffect(() => {
    cancelled.current = false;
    if (!options.enabled) {
      setHistory({ ...EMPTY_HISTORY, channel });
      setState("idle");
      setError(null);
      return () => {
        cancelled.current = true;
      };
    }
    setHistory({ ...EMPTY_HISTORY, channel });
    setState("loading");
    setError(null);
    void reload();
    const id = window.setInterval(() => {
      void reload();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [channel, options.enabled, reload]);

  useEvent("activation:complete", () => {
    void reload();
  });

  return { history, reload, isLoading, state, error };
}
