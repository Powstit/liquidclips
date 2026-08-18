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

// 2026-07-08 · Chat drift fix. Widened from the two hard-coded literals
// to any string so the frontend can point the composer at any seeded
// slug from /community/channels (bugs, free-clipper-lobby,
// premium-rewards-hq, uncle-daniel-clips, etc.). The backend
// `ALLOWED_CHANNELS` set in junior-backend/app/routes/chat.py is the
// runtime source of truth — an unknown slug returns HTTP 400.
export type ChatChannel = string;
export type ChatRole = "founder" | "staff" | "mod" | "bot" | "member";
export type PinSeverity = "info" | "warning" | "critical";

export interface ReactionSummary {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
}

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
  /** 2026-08-17 · emoji reactions. Empty = none yet. */
  reactions: ReactionSummary[];
  /** 2026-08-17 · @mentions resolved to real user ids at post time. */
  mentioned_user_ids: string[];
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
  /** Stage 4 infinite-history cursor. `true` when the server holds at
   *  least one message strictly older than `messages[0]`. The Community
   *  top-sentinel IntersectionObserver gates `loadOlder()` on this so a
   *  fully-loaded room does not keep firing empty before_id requests.
   *  Optional so a legacy backend that has not shipped the Stage-4
   *  widening (returns no `has_more`) reads as `false` and no crash. */
  has_more?: boolean;
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

export interface ChatPresenceUser {
  user_id: string;
  display_name: string;
  role: ChatRole;
}

export type VoiceSignalPayload =
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

export type WsInboundMessage =
  | { type: "message"; channel: string; data: ChatMessage }
  | { type: "presence"; channel: string; online_count: number; online_users: ChatPresenceUser[] }
  | { type: "unpin"; channel: string; data: { message_id: string } }
  | {
      type: "reaction";
      channel: string;
      data: { message_id: string; emoji: string; user_id: string; action: "add" | "remove" };
    }
  | { type: "voice-presence"; channel: string; participants: string[] }
  | { type: "voice-signal"; channel: string; from_user_id: string; payload: VoiceSignalPayload };

/** Applies a live reaction delta to one message's reaction list. The
 *  broadcast carries the raw (emoji, user_id, action) rather than a
 *  pre-aggregated summary, because `reacted_by_me` is viewer-relative —
 *  a summary computed server-side for the reactor would be wrong for
 *  every other connected client. `viewerUserId` may be null (viewer
 *  identity not resolved yet); the delta still updates the count, it
 *  just can't mark reacted_by_me for anyone in that case. */
function applyReactionDelta(
  message: ChatMessage,
  delta: { emoji: string; user_id: string; action: "add" | "remove" },
  viewerUserId: string | null,
): ChatMessage {
  const isMe = viewerUserId !== null && delta.user_id === viewerUserId;
  const existing = message.reactions.find((r) => r.emoji === delta.emoji);
  if (delta.action === "add") {
    if (existing) {
      return {
        ...message,
        reactions: message.reactions.map((r) =>
          r.emoji === delta.emoji
            ? { ...r, count: r.count + 1, reacted_by_me: r.reacted_by_me || isMe }
            : r,
        ),
      };
    }
    return {
      ...message,
      reactions: [...message.reactions, { emoji: delta.emoji, count: 1, reacted_by_me: isMe }],
    };
  }
  // action === "remove"
  if (!existing) return message;
  const nextCount = existing.count - 1;
  return {
    ...message,
    reactions:
      nextCount <= 0
        ? message.reactions.filter((r) => r.emoji !== delta.emoji)
        : message.reactions.map((r) =>
            r.emoji === delta.emoji
              ? { ...r, count: nextCount, reacted_by_me: isMe ? false : r.reacted_by_me }
              : r,
          ),
  };
}

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

/** http(s):// → ws(s):// for the same host, so the live socket always
 *  points at whatever backend the REST calls above are using. */
function lcBackendWsUrl(): string {
  return lcBackendUrl().replace(/^http/, "ws");
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
  has_more: false,
};

export interface FetchHistoryOpts {
  /** Stage 4 keyset cursor. When set, the backend returns messages
   *  strictly older than this id and reports `has_more` for the
   *  chunk BEFORE that. */
  before_id?: string;
}

export async function fetchChatHistory(
  channel: ChatChannel,
  opts: FetchHistoryOpts = {},
): Promise<ChatHistory> {
  return (await fetchChatHistoryResult(channel, opts)).history;
}

export async function fetchChatHistoryResult(
  channel: ChatChannel,
  opts: FetchHistoryOpts = {},
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
    const params = new URLSearchParams({ channel });
    if (opts.before_id) params.set("before_id", opts.before_id);
    const r = await fetch(
      `${lcBackendUrl()}/chat/messages?${params.toString()}`,
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
  } catch (err) {
    // 2026-07-03 · previously silent · this is the EXACT catch that
    // produces the "Community offline" UI. Log the real error to
    // AppData/client-diagnostics.log via diagBuffer so we can read
    // it from bash instead of relying on WKWebView DevTools.
    void import("./diagBuffer").then((m) => {
      m.logDiagError("chat.fetchChatHistoryResult", err, {
        channel,
        url: `${lcBackendUrl()}/chat/messages`,
        has_jwt: !!getJwt(),
      });
    }).catch(() => { /* noop */ });
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

/** Toggle the caller's reaction on a message — react if they haven't,
 *  un-react if they already have. Returns the up-to-date reaction list
 *  for THIS viewer, or null on failure (caller keeps whatever it had). */
export async function reactToMessage(
  messageId: string,
  emoji: string,
): Promise<ReactionSummary[] | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const r = await fetch(
      `${lcBackendUrl()}/chat/message/${encodeURIComponent(messageId)}/react`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({ emoji }),
      },
    );
    if (!r.ok) return null;
    return (await r.json()) as ReactionSummary[];
  } catch {
    return null;
  }
}

/** Unread message count per channel, server-tracked so it follows the
 *  user across devices (not localStorage). Empty object on any failure
 *  — callers treat a missing key as 0, never as an error state worth
 *  surfacing (a badge silently not appearing is fine; a crash isn't). */
export async function fetchUnreadCounts(): Promise<Record<string, number>> {
  const jwt = getJwt();
  if (!jwt) return {};
  try {
    const r = await fetch(`${lcBackendUrl()}/chat/unread-counts`, {
      cache: "no-store",
      headers: authHeader(),
    });
    if (!r.ok) return {};
    return (await r.json()) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function markChannelRead(channel: ChatChannel): Promise<void> {
  const jwt = getJwt();
  if (!jwt) return;
  try {
    await fetch(`${lcBackendUrl()}/chat/channel/${encodeURIComponent(channel)}/read`, {
      method: "POST",
      cache: "no-store",
      headers: authHeader(),
    });
  } catch {
    /* best-effort — a missed read-mark just means the badge lingers a bit */
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

/** Upload the caller's own image (png/jpeg/gif/webp, 8MB max — same
 *  caps the backend enforces). Returns the servable URL on success. The
 *  returned URL always ends in a recognised image extension, so the
 *  existing mediaUrlFromContent() detection in ChatPanel picks it up
 *  for inline rendering with no separate code path needed. */
export async function uploadChatMedia(file: File): Promise<{ url: string } | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const formData = new FormData();
    formData.append("file", file);
    const r = await fetch(`${lcBackendUrl()}/chat/upload`, {
      method: "POST",
      body: formData,
      headers: authHeader(), // no content-type — browser sets the multipart boundary
    });
    if (!r.ok) return null;
    return (await r.json()) as { url: string };
  } catch {
    return null;
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

/** Poll-on-mount + refresh-on-activation hook, plus a live WebSocket
 *  (`/chat/ws`) for instant message/presence push. 2026-08-17 — the
 *  poll used to be the ONLY update path (10s latency on every message
 *  and no real presence). It now stays as a resync/offline fallback —
 *  cheap insurance if the socket drops (sleep/wake, network blip) —
 *  while the socket carries the actual real-time experience. */
const POLL_INTERVAL_MS = 10_000;
/** Backoff ladder for WS reconnect attempts after an unexpected close. */
const WS_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000];

export function useChatChannel(
  channel: ChatChannel,
  options: { enabled: boolean; viewerUserId?: string | null },
): {
  history: ChatHistory;
  reload: () => Promise<void>;
  loadOlder: () => Promise<void>;
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMore: boolean;
  state: ChatConnectionState;
  error: string | null;
  /** Real live count from the WebSocket's presence broadcast. `null`
   *  until the socket has actually connected at least once — never a
   *  fabricated number (desktop-2's honest-empty-state rule). */
  onlineCount: number | null;
  onlineUsers: ChatPresenceUser[];
  /** Latest voice-presence/voice-signal frame from the socket, or null
   *  before the first one arrives. New object reference per event so a
   *  consumer's useEffect fires even on a repeated-shape payload. */
  voiceEvent: Extract<WsInboundMessage, { type: "voice-presence" | "voice-signal" }> | null;
  /** Send an arbitrary JSON payload over this channel's live socket —
   *  used by voice signaling. No-op while disconnected/reconnecting. */
  sendRaw: (payload: unknown) => void;
} {
  // Stage 4 · local `history` is the UNION of every fetched chunk
  // (newest-N polls + older keyset chunks), deduped by message.id and
  // sorted ASC by created_at. `reload()` merges newest-N into the
  // union; `loadOlder()` prepends older-N via before_id. This preserves
  // the reader's scroll position when the 10-second poll fires — an
  // older-loaded chunk is not clobbered by the poll's newest-window.
  const [history, setHistory] = useState<ChatHistory>({
    ...EMPTY_HISTORY,
    channel,
  });
  const [isLoading, setLoading] = useState(false);
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const [state, setState] = useState<ChatConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<ChatPresenceUser[]>([]);
  // 2026-08-17 · voice signaling piggybacks on this same connection (a
  // second WS per channel would double-count presence server-side). A
  // new object reference on every event so a consuming effect re-fires
  // even for a repeated/duplicate-shaped payload.
  const [voiceEvent, setVoiceEvent] = useState<
    Extract<WsInboundMessage, { type: "voice-presence" | "voice-signal" }> | null
  >(null);
  const socketRef = useRef<WebSocket | null>(null);
  const cancelled = useRef(false);
  // Mirror of `history.messages` for closure-free reads inside
  // async callbacks so `loadOlder()` can compute a stable
  // `before_id` even between renders.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = history.messages;

  const mergeMessages = useCallback(
    (existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
      if (incoming.length === 0) return existing;
      const seen = new Set(existing.map((m) => m.id));
      const additions = incoming.filter((m) => !seen.has(m.id));
      if (additions.length === 0) return existing;
      const combined = existing.concat(additions);
      // Sort ASC by created_at so the DOM renders oldest → newest
      // regardless of which chunk arrived first.
      combined.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return combined;
    },
    [],
  );

  const reload = useCallback(async () => {
    if (!options.enabled) return;
    setLoading(true);
    setState((current) => current === "idle" ? "loading" : current);
    const result = await fetchChatHistoryResult(channel);
    if (cancelled.current) return;
    setState(result.state);
    setError(result.error);
    setLoading(false);
    if (result.state !== "ready") {
      // Transport failure: keep the local union intact so a transient
      // 401 / 5xx during a poll cycle doesn't wipe already-loaded
      // messages the user is currently reading.
      return;
    }
    setHistory((prev) => {
      const merged = mergeMessages(prev.messages, result.history.messages);
      return {
        ...result.history,
        messages: merged,
        // `has_more` for the OLDEST-most edge is only meaningful for
        // the initial page + subsequent older chunks. The newest-window
        // poll does not shrink `has_more`; take the OR so the sentinel
        // stays live until an older-chunk fetch explicitly reports
        // `has_more: false`.
        has_more: (prev.has_more ?? false) || (result.history.has_more ?? false),
      };
    });
  }, [channel, options.enabled, mergeMessages]);

  const loadOlder = useCallback(async () => {
    if (!options.enabled) return;
    if (isLoadingOlder) return;
    const current = messagesRef.current;
    if (current.length === 0) return;
    const beforeId = current[0].id;
    setLoadingOlder(true);
    const result = await fetchChatHistoryResult(channel, {
      before_id: beforeId,
    });
    if (cancelled.current) {
      setLoadingOlder(false);
      return;
    }
    setLoadingOlder(false);
    if (result.state !== "ready") {
      // Preserve the top sentinel visibility so the user can retry via
      // scroll; surface the transient error so the UI can hint at it.
      setError(result.error);
      return;
    }
    setHistory((prev) => {
      const merged = mergeMessages(prev.messages, result.history.messages);
      return {
        ...prev,
        messages: merged,
        // Only the OLDER-chunk response is authoritative for
        // `has_more` — when it flips to `false` the sentinel disarms.
        has_more: result.history.has_more ?? false,
      };
    });
  }, [channel, options.enabled, isLoadingOlder, mergeMessages]);

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
    // Channel switch resets the union — old messages from `#global`
    // must not bleed into `#agency-vip` and vice versa.
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

  // Live socket — instant message/presence push. Runs alongside the poll
  // above rather than replacing it: the poll is cheap insurance if the
  // socket drops (sleep/wake, flaky network, a proxy that kills idle
  // WS connections) and needs no reconnect logic of its own.
  useEffect(() => {
    if (!options.enabled) {
      setOnlineCount(null);
      setOnlineUsers([]);
      return;
    }
    const jwt = getJwt();
    if (!jwt) {
      setOnlineCount(null);
      setOnlineUsers([]);
      return;
    }
    const viewerUserId = options.viewerUserId ?? null;

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (stopped) return;
      const url = `${lcBackendWsUrl()}/chat/ws?channel=${encodeURIComponent(channel)}&token=${encodeURIComponent(jwt)}`;
      const ws = new WebSocket(url);
      socket = ws;
      socketRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event) => {
        let parsed: WsInboundMessage;
        try {
          parsed = JSON.parse(event.data as string) as WsInboundMessage;
        } catch {
          return;
        }
        if (parsed.channel !== channel) return;
        if (parsed.type === "message") {
          setHistory((prev) => ({
            ...prev,
            messages: mergeMessages(prev.messages, [parsed.data]),
          }));
        } else if (parsed.type === "presence") {
          setOnlineCount(parsed.online_count);
          setOnlineUsers(parsed.online_users);
        } else if (parsed.type === "unpin") {
          setHistory((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === parsed.data.message_id
                ? { ...m, pinned: false, announcement_id: null }
                : m,
            ),
          }));
        } else if (parsed.type === "reaction") {
          setHistory((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === parsed.data.message_id
                ? applyReactionDelta(m, parsed.data, viewerUserId ?? null)
                : m,
            ),
          }));
        } else if (parsed.type === "voice-presence" || parsed.type === "voice-signal") {
          setVoiceEvent(parsed);
        }
      };

      ws.onclose = () => {
        if (socketRef.current === ws) socketRef.current = null;
        if (stopped) return;
        setOnlineCount(null);
        setOnlineUsers([]);
        const delay = WS_RECONNECT_DELAYS_MS[
          Math.min(attempt, WS_RECONNECT_DELAYS_MS.length - 1)
        ];
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      // onerror is always followed by onclose per the WebSocket spec —
      // no separate handling needed, it would just double-schedule the
      // reconnect above.
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socketRef.current = null;
      socket?.close();
    };
  }, [channel, options.enabled, options.viewerUserId, mergeMessages]);

  useEvent("activation:complete", () => {
    void reload();
  });

  // Voice signaling piggybacks on this same connection — see voiceEvent
  // above. No-op (not an error) when the socket isn't open; a caller
  // mid-reconnect just loses that one signal, same as any other
  // best-effort realtime message.
  const sendRaw = useCallback((payload: unknown) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  return {
    history,
    reload,
    loadOlder,
    isLoading,
    isLoadingOlder,
    hasMore: history.has_more ?? false,
    state,
    error,
    onlineCount,
    onlineUsers,
    voiceEvent,
    sendRaw,
  };
}
