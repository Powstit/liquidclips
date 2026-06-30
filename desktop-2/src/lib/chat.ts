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
}

export interface ChatHistory {
  channel: ChatChannel;
  messages: ChatMessage[];
  can_write: boolean;
  viewer_role: ChatRole;
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
  const jwt = getJwt();
  if (!jwt) return { ...EMPTY_HISTORY, channel };
  try {
    const r = await fetch(
      `${lcBackendUrl()}/chat/messages?channel=${encodeURIComponent(channel)}`,
      { cache: "no-store", headers: authHeader() },
    );
    if (!r.ok) return { ...EMPTY_HISTORY, channel };
    const data = (await r.json()) as ChatHistory;
    return data ?? { ...EMPTY_HISTORY, channel };
  } catch {
    return { ...EMPTY_HISTORY, channel };
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
  const jwt = getJwt();
  if (!jwt) return null;
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
    if (!r.ok) return null;
    const data = (await r.json()) as { message: ChatMessage };
    return data?.message ?? null;
  } catch {
    return null;
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
}

export async function searchMedia(
  provider: MediaProvider,
  q: string,
): Promise<MediaSearchResult> {
  const empty: MediaSearchResult = {
    provider,
    results: [],
    setupRequired: false,
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
    if (!r.ok) return empty;
    const data = (await r.json()) as { provider: MediaProvider; results: MediaResult[] };
    return {
      provider,
      results: Array.isArray(data?.results) ? data.results : [],
      setupRequired: false,
    };
  } catch {
    return empty;
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
} {
  const [history, setHistory] = useState<ChatHistory>({
    ...EMPTY_HISTORY,
    channel,
  });
  const [isLoading, setLoading] = useState(false);
  const cancelled = useRef(false);

  const reload = useCallback(async () => {
    if (!options.enabled) return;
    setLoading(true);
    const next = await fetchChatHistory(channel);
    if (!cancelled.current) setHistory(next);
    setLoading(false);
  }, [channel, options.enabled]);

  useEffect(() => {
    cancelled.current = false;
    if (!options.enabled) {
      setHistory({ ...EMPTY_HISTORY, channel });
      return () => {
        cancelled.current = true;
      };
    }
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

  return { history, reload, isLoading };
}
