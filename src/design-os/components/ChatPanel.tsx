/**
 * ChatPanel · v2.2.10
 *
 * Slide-in chat overlay anchored to the bottom-right of the viewport.
 * Mounted by AppShell and gated on an `open` prop driven by ChatToggle.
 * When closed, renders nothing — that preserves the pinned Workstation
 * visual baseline at 0% drift.
 *
 * Surface composition:
 *   - Header: channel name + close
 *   - Tabs:   #global · #agency-vip (the second tab is locked-state for
 *             users without a Whop sub; the picker disables it inline)
 *   - Stream: scroll-anchored message list (scrollTop pinned to bottom
 *             on new-message arrival when the user is already at the
 *             bottom — never yanks scroll when they're reading history)
 *   - Tray:   emoji quick-insert row (no external API · pure text)
 *   - Media:  Pexels + Giphy picker (powered by the backend proxy;
 *             surfaces a setup hint when keys are absent in env)
 *   - Compose: textarea + send + pin toggle (pin only renders to
 *             users with a chat role of mod/staff/founder)
 *
 * The pin → Announcement bridge is server-side: posting with pinned
 * inserts a sibling Announcement row that AnnouncementBanner picks up
 * on its next /sync, so the sticky tinted header lives in the existing
 * banner stack — no new top-of-viewport surface to maintain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  postHideMessage,
  postMute24h,
  postWarnMessage,
  type ModerationResult,
} from "../../lib/chatModeration";
import { bus } from "../bridge";

import {
  fetchArcadeLeaderboard,
  searchMedia,
  sendChatMessageDetailed,
  useChatChannel,
  type ArcadeLeaderboardEntry,
  type ChatChannel,
  type ChatMessage,
  type ChatRole,
  type MediaProvider,
  type MediaResult,
} from "../../lib/chat";
import { openInApp } from "../../lib/openInApp";
import { SafeImg } from "../../components/safe";

import "./ChatPanel.css";

const QUICK_EMOJI = [
  "🔥", "💯", "👏", "🙌", "🤝", "👀", "💡", "✅", "🚀", "💸",
  "🎬", "🎯", "📈", "🧠", "❤️", "😂",
];

const BADGE_LABEL: Record<ChatRole, string | null> = {
  founder: "Founder",
  staff: "Staff",
  mod: "Mod",
  bot: "Bot",
  member: null,
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function timeLabel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export interface MediaTrayProps {
  onPick: (asset: MediaResult) => void;
  onClose?: () => void;
}

export function MediaTray({ onPick, onClose }: MediaTrayProps): JSX.Element {
  const [provider, setProvider] = useState<MediaProvider>("giphy");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MediaResult[]>([]);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setSetupRequired(false);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSetupRequired(false);
    const handle = window.setTimeout(async () => {
      const res = await searchMedia(provider, q.trim());
      if (cancelled) return;
      setResults(res.results);
      setSetupRequired(res.setupRequired);
      setError(res.error);
      setLoading(false);
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [q, provider, retryNonce]);

  return (
    <div
      className="lc-chat-panel-media"
      data-testid="lc-chat-media"
      role="region"
      aria-label="GIF and photo search"
    >
      <div className="lc-chat-media-head">
        <div className="lc-chat-media-tabs">
          {(["giphy", "pexels"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className="lc-chat-media-tab"
              data-active={provider === p}
              aria-pressed={provider === p}
              onClick={() => setProvider(p)}
            >
              {p === "giphy" ? "GIFs" : "Photos"}
            </button>
          ))}
        </div>
        {onClose ? (
          <button
            type="button"
            className="lc-chat-media-close"
            onClick={onClose}
            aria-label="Close media search"
          >
            ×
          </button>
        ) : null}
      </div>
      <input
        className="lc-chat-media-input"
        type="text"
        placeholder={`Search ${provider}…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={`Search ${provider === "giphy" ? "GIFs" : "photos"}`}
        autoFocus
      />
      {setupRequired ? (
        <div className="lc-chat-media-setup">
          {provider === "giphy"
            ? "Set GIPHY_API_KEY on the backend to enable GIF search."
            : "Set PEXELS_API_KEY on the backend to enable photo search."}
        </div>
      ) : error ? (
        <div className="lc-chat-media-setup is-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="lc-chat-media-setup">Searching…</div>
      ) : results.length === 0 ? (
        <div className="lc-chat-media-setup">
          {q.trim().length === 0
            ? "Type to search."
            : q.trim().length < 2
              ? "Keep typing…"
              : "No results."}
        </div>
      ) : (
        <div className="lc-chat-media-grid">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="lc-chat-media-card"
              onClick={() => onPick(r)}
              title={r.title ?? `Use ${provider === "giphy" ? "GIF" : "photo"}`}
              aria-label={r.title
                ? `Use ${r.title}`
                : `Use ${provider === "giphy" ? "GIF" : "photo"}`}
            >
              <img
                src={r.preview_url}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.closest("button")?.setAttribute("data-image-error", "true");
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface MessageRowProps {
  row: ChatMessage;
  viewerRole?: ChatRole;
}

const MEDIA_URL_RE = /https?:\/\/[^\s]+/i;

function mediaUrlFromContent(content: string): string | null {
  const match = content.match(MEDIA_URL_RE)?.[0];
  if (!match) return null;
  try {
    const url = new URL(match);
    const host = url.hostname.toLowerCase();
    const mediaHost = host === "giphy.com"
      || host.endsWith(".giphy.com")
      || host === "pexels.com"
      || host.endsWith(".pexels.com")
      || /\.(gif|jpe?g|png|webp)$/i.test(url.pathname);
    return mediaHost ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MessageRow({ row, viewerRole = "member" }: MessageRowProps): JSX.Element {
  const badge = BADGE_LABEL[row.role];
  const mediaUrl = mediaUrlFromContent(row.content);
  const textContent = mediaUrl ? row.content.replace(mediaUrl, "").trim() : row.content;
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canModerate = viewerRole === "founder"
    || viewerRole === "staff"
    || viewerRole === "mod";

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", keydown);
    };
  }, [menuOpen]);

  const copyMessageLink = async (): Promise<void> => {
    const link = `${window.location.origin}${window.location.pathname}?skipIntro=1#/community?message=${encodeURIComponent(row.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
    }
  };

  // Stage 7 · context-menu wire under the F1 carve-out. `window.confirm`
  // is the interim safety gate for destructive/high-impact actions per
  // doc §693; a proper `<Confirm />` modal (with keyboard focus trap +
  // brand chrome) lands in a follow-up sprint. Success + failure both
  // emit `toast` on the bus so the moderator sees the outcome without
  // any local state; the ChatPanel doesn't render moderation status
  // inline. On non-`ready` state the menu closes so a follow-up right-
  // click is required — matches the confirm/rollback intent of §695
  // without introducing an optimistic-UI shim in this cycle.
  const toast = useCallback(
    (kind: "success" | "error" | "warning" | "info", title: string, body: string) => {
      bus.emit("toast", { kind, title, body });
    },
    [],
  );
  const surfaceResult = useCallback(
    <T,>(result: ModerationResult<T>, okTitle: string, okBody: string): boolean => {
      if (result.state === "ready") {
        toast("success", okTitle, okBody);
        return true;
      }
      const errKind = result.state === "forbidden" ? "warning" : "error";
      toast(
        errKind,
        result.state === "forbidden" ? "Not authorised" : "Moderation failed",
        result.error ?? "The server did not accept the request.",
      );
      return false;
    },
    [toast],
  );
  const handleHide = useCallback(async () => {
    if (!window.confirm(`Hide this message from ${row.username}?`)) return;
    setMenuOpen(false);
    const result = await postHideMessage(row.id);
    surfaceResult(result, "Message hidden", "Content is now [removed by moderator].");
  }, [row.id, row.username, surfaceResult]);
  const handleWarn = useCallback(async () => {
    if (!window.confirm(`Warn ${row.username} for this message? A record is added to the audit log.`)) return;
    setMenuOpen(false);
    const result = await postWarnMessage(row.id);
    surfaceResult(result, "Warning delivered", `Audit row recorded against ${row.username}.`);
  }, [row.id, row.username, surfaceResult]);
  const handleMute = useCallback(async () => {
    if (!window.confirm(`Mute ${row.username} from Community chat for 24 hours?`)) return;
    setMenuOpen(false);
    const result = await postMute24h(row.id);
    surfaceResult(result, "User muted", `${row.username} cannot post for 24 hours.`);
  }, [row.id, row.username, surfaceResult]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="lc-chat-row"
      data-pinned={row.pinned}
      data-role={row.role}
      data-moderation-available={canModerate ? "true" : "false"}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="lc-chat-row-avatar">
        {row.avatar_url ? (
          <SafeImg src={row.avatar_url} fallback={<>{initials(row.username)}</>} alt={row.username} />
        ) : (
          initials(row.username)
        )}
      </div>
      <div className="lc-chat-row-body">
        <div className="lc-chat-row-meta">
          <span className="lc-chat-row-name">{row.username}</span>
          {badge ? (
            <span className="lc-chat-row-badge" data-role={row.role}>
              {badge}
            </span>
          ) : null}
          {row.arcade_high_score > 0 ? (
            <span
              className="lc-chat-row-arcade"
              data-testid="lc-chat-row-arcade"
              title="Space Invaders best score"
            >
              🏆 {row.arcade_high_score.toLocaleString()}
            </span>
          ) : null}
          {row.pinned ? <span className="lc-chat-row-pin">Pinned</span> : null}
          <span className="lc-chat-row-time">{timeLabel(row.created_at)}</span>
        </div>
        <div className="lc-chat-row-content">
          {textContent ? <span>{textContent}</span> : null}
          {mediaUrl ? (
            <button
              type="button"
              className="lc-chat-row-media"
              onClick={() => void openInApp(mediaUrl)}
              aria-label="Open shared media"
            >
              <img
                src={mediaUrl}
                alt="Shared media"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.parentElement?.setAttribute("data-image-error", "true");
                }}
              />
              <span>Open shared media</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="lc-chat-row-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="lc-chat-row-menu-trigger"
          aria-label={`Message actions for ${row.username}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          •••
        </button>
        {menuOpen ? (
          <div
            className="lc-chat-row-menu"
            role="menu"
            aria-label={`Actions for message from ${row.username}`}
          >
            <button type="button" role="menuitem" onClick={() => void copyMessageLink()}>
              {copyState === "copied"
                ? "Link copied"
                : copyState === "failed"
                  ? "Copy unavailable"
                  : "Copy link to message"}
            </button>
            {canModerate ? (
              <>
                <span className="lc-chat-row-menu-label">Moderator tools</span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleHide()}
                  data-testid="chat-mod-hide"
                >
                  Hide message
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleWarn()}
                  data-testid="chat-mod-warn"
                >
                  Warn user
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleMute()}
                  data-testid="chat-mod-mute24h"
                >
                  Mute for 24 hours
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

export interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

const STORAGE_KEY = "lc.chat.last-channel.v1";

export function ChatPanel({ open, onClose }: ChatPanelProps): JSX.Element | null {
  const initialChannel: ChatChannel = (() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "agency-vip") return "agency-vip";
    } catch {
      /* private mode · fall through */
    }
    return "global";
  })();

  const [channel, setChannel] = useState<ChatChannel>(initialChannel);
  const [composer, setComposer] = useState("");
  const [pinNext, setPinNext] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const autoStickRef = useRef(true);
  const [leaderboard, setLeaderboard] = useState<ArcadeLeaderboardEntry[] | null>(
    null,
  );
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const { history, reload, isLoading, state, error } = useChatChannel(channel, {
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (leaderboard !== null) {
        setLeaderboard(null);
      } else if (showMedia) {
        setShowMedia(false);
      } else if (showEmoji) {
        setShowEmoji(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leaderboard, onClose, open, showEmoji, showMedia]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, channel);
    } catch {
      /* noop */
    }
  }, [channel]);

  // Track whether the user is at the bottom — auto-stick only when so.
  // Prevents the chat from yanking scroll when they're reading history.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const onScroll = () => {
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      autoStickRef.current = fromBottom < 32;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = streamRef.current;
    if (!el) return;
    if (autoStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history.messages.length, open]);

  const canPin = useMemo(
    () =>
      history.viewer_role === "founder"
      || history.viewer_role === "staff"
      || history.viewer_role === "mod",
    [history.viewer_role],
  );

  const openLeaderboard = async (): Promise<void> => {
    setLeaderboardLoading(true);
    const list = await fetchArcadeLeaderboard(10);
    setLeaderboard(list);
    setLeaderboardLoading(false);
  };

  const send = async (): Promise<void> => {
    const content = composer.trim();
    if (!content || sending) return;
    // v2.2.11 · inline slash command parser. "/leaderboard" never sends
    // a real message — it just opens the overlay panel and clears the
    // composer so the user can keep typing afterwards.
    if (content.toLowerCase() === "/leaderboard") {
      setComposer("");
      void openLeaderboard();
      return;
    }
    setSending(true);
    setSendError(null);
    const out = await sendChatMessageDetailed({
      channel,
      content,
      pinned: pinNext && canPin,
    });
    setSending(false);
    if (out.message) {
      setComposer("");
      setPinNext(false);
      autoStickRef.current = true;
      await reload();
    } else {
      setSendError(out.error ?? "Message not sent.");
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="lc-chat-panel"
          id="lc-chat-panel"
          className="lc-chat-panel"
          data-testid="lc-chat-panel"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        >
          <div className="lc-chat-panel-header">
            <span className="lc-chat-panel-title">
              Lounge · #{channel === "global" ? "global" : "agency-vip"}
            </span>
            <button
              type="button"
              className="lc-chat-panel-close"
              onClick={onClose}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          <div className="lc-chat-panel-tabs">
            <button
              type="button"
              className="lc-chat-panel-tab"
              data-active={channel === "global"}
              onClick={() => setChannel("global")}
            >
              #global-lounge
            </button>
            <button
              type="button"
              className="lc-chat-panel-tab"
              data-active={channel === "agency-vip"}
              onClick={() => setChannel("agency-vip")}
            >
              #agency-vip
            </button>
          </div>

          <div className="lc-chat-panel-stream" ref={streamRef}>
            {state === "loading" || isLoading && state === "idle" ? (
              <div className="lc-chat-panel-empty" role="status">Loading real messages…</div>
            ) : error ? (
              <div className="lc-chat-panel-empty is-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={() => void reload()}>Retry</button>
              </div>
            ) : history.messages.length === 0 ? (
              <div className="lc-chat-panel-empty">
                {history.can_write
                  ? "Be the first to drop a clip in here."
                  : "Locked. Sync your Whop pass to unlock agency-vip."}
              </div>
            ) : (
              history.messages.map((row) => (
                <MessageRow key={row.id} row={row} viewerRole={history.viewer_role} />
              ))
            )}
          </div>

          {showEmoji ? (
            <div className="lc-chat-panel-tray" data-testid="lc-chat-emoji-tray">
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="lc-chat-emoji"
                  onClick={() => setComposer((prev) => prev + e)}
                >
                  {e}
                </button>
              ))}
            </div>
          ) : null}

          {showMedia ? (
            <MediaTray
              onClose={() => setShowMedia(false)}
              onPick={(asset) => {
                setComposer((prev) => `${prev}${prev ? " " : ""}${asset.full_url}`);
                setShowMedia(false);
              }}
            />
          ) : null}

          {leaderboard !== null ? (
            <div
              className="lc-chat-leaderboard"
              data-testid="lc-chat-leaderboard"
              role="dialog"
              aria-label="Arcade leaderboard"
            >
              <div className="lc-chat-leaderboard-header">
                <span>🏆 Top 10 · Space Invaders</span>
                <button
                  type="button"
                  className="lc-chat-panel-close"
                  onClick={() => setLeaderboard(null)}
                  aria-label="Close leaderboard"
                >
                  ×
                </button>
              </div>
              {leaderboardLoading ? (
                <div className="lc-chat-leaderboard-empty">Loading…</div>
              ) : leaderboard.length === 0 ? (
                <div className="lc-chat-leaderboard-empty">
                  No scores yet · be the first to land a record.
                </div>
              ) : (
                <ol className="lc-chat-leaderboard-list">
                  {leaderboard.map((entry, i) => (
                    <li key={entry.user_id} className="lc-chat-leaderboard-row">
                      <span className="lc-chat-leaderboard-rank">#{i + 1}</span>
                      <span className="lc-chat-leaderboard-name">
                        {entry.username}
                      </span>
                      {BADGE_LABEL[entry.role] ? (
                        <span
                          className="lc-chat-row-badge"
                          data-role={entry.role}
                        >
                          {BADGE_LABEL[entry.role]}
                        </span>
                      ) : null}
                      <span className="lc-chat-leaderboard-score">
                        {entry.arcade_high_score.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}

          <div className="lc-chat-composer">
            {sendError ? (
              <div className="lc-chat-send-error" role="alert">
                <span>{sendError}</span>
                <button type="button" onClick={() => void send()}>Retry</button>
              </div>
            ) : null}
            <button
              type="button"
              className="lc-chat-composer-toggle"
              data-active={showEmoji}
              aria-pressed={showEmoji}
              onClick={() => {
                setShowEmoji((p) => !p);
                if (!showEmoji) setShowMedia(false);
              }}
              aria-label="Emoji"
            >
              😀
            </button>
            <button
              type="button"
              className="lc-chat-composer-toggle"
              data-active={showMedia}
              aria-pressed={showMedia}
              onClick={() => {
                setShowMedia((p) => !p);
                if (!showMedia) setShowEmoji(false);
              }}
              aria-label="Media"
            >
              🖼
            </button>
            {canPin ? (
              <button
                type="button"
                className="lc-chat-composer-toggle"
                data-active={pinNext}
                aria-pressed={pinNext}
                onClick={() => setPinNext((p) => !p)}
                title="Pin this message to the banner stack"
                aria-label="Pin"
              >
                📌
              </button>
            ) : null}
            <textarea
              value={composer}
              aria-label={`Message #${channel}`}
              onChange={(e) => {
                setComposer(e.target.value);
                if (sendError) setSendError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                history.can_write
                  ? "Type a message · Enter to send"
                  : "Read-only · sync Whop to unlock"
              }
              disabled={!history.can_write || sending}
            />
            <button
              type="button"
              className="lc-chat-composer-send"
              onClick={() => void send()}
              disabled={
                !history.can_write
                || sending
                || composer.trim().length === 0
              }
            >
              Send
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
