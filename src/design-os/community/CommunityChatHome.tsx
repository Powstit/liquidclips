import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  sendChatMessageDetailed,
  useChatChannel,
  type ChatChannel,
} from "../../lib/chat";
import { usePresencePreference } from "../../lib/presencePreference";
import { bus } from "../bridge";
import { useMe } from "../state/useMe";
import { useTierCaps } from "../state/useTierCaps";
import { MediaTray, MessageRow } from "../components/ChatPanel";
// ag-18 · ag-19 · 2026-07-06 · Watchdog wrap · Sovereign-Operator Protocol.
// DEMO tier: WhopChat fleet framework ready but WHOP_AGENT_ENABLED=false by
// default; chat panel + post-message surfaces are user-reachable via #/community
// so a crash inside the chat stream or composer must render KadeRepairScreen
// rather than white-screen the shell. Same wrap covers ag-18 (chat panel) and
// ag-19 (post message) — both live in this single component tree.
import { Watchdog } from "../../lib/watchdog/Watchdog";
import "./CommunityChatHome.css";

type CommunityRoomId =
  | "global"
  | "clippers-lounge"
  | "campaign-drops"
  | "fan-boost"
  | "agency-vip";

interface RoomSpec {
  id: CommunityRoomId;
  label: string;
  description: string;
  channel?: ChatChannel;
  pendingContract?: string;
}

const ROOMS: readonly RoomSpec[] = [
  {
    id: "global",
    label: "global",
    description: "Open community chat",
    channel: "global",
  },
  {
    id: "clippers-lounge",
    label: "clippers-lounge",
    description: "Dedicated room · server rollout pending",
    pendingContract: "This room needs a backend channel before messages can be stored.",
  },
  {
    id: "campaign-drops",
    label: "campaign-drops",
    description: "Campaign notices · server rollout pending",
    pendingContract: "Campaign room membership is not available from the server yet.",
  },
  {
    id: "fan-boost",
    label: "fan-boost",
    description: "Boost coordination · server rollout pending",
    pendingContract: "Fan Boost chat does not have a persistence contract yet.",
  },
  {
    id: "agency-vip",
    label: "agency-vip",
    description: "Agency members",
    channel: "agency-vip",
  },
];

const QUICK_EMOJI = ["🔥", "👏", "💯", "🎬", "🎯", "🚀", "❤️", "😂"];

/** Stage 4 · long-message clamp threshold. `.lc-chat-row-content > span`
 *  is line-clamped to 3 lines via CSS; the Show more toggle only needs
 *  to render when the content is realistically LONG enough to wrap
 *  past 3 lines. 240 chars is a safe upper bound for typical Inter
 *  16px / 1.4 line-height inside the ~600px stream — below it the
 *  clamp never triggers so the toggle would be a lie. */
const CLAMP_THRESHOLD_CHARS = 240;

function displayName(email: string | null | undefined): string {
  if (!email) return "Clipper";
  const local = email.split("@")[0]?.trim();
  return local || "Clipper";
}

export function CommunityChatHome(): JSX.Element {
  const tier = useTierCaps();
  const me = useMe();
  const { visibility, setVisibility } = usePresencePreference();
  const [activeRoomId, setActiveRoomId] = useState<CommunityRoomId>("global");
  const [roomSearch, setRoomSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [sending, setSending] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  // Stage 4 · top-sentinel target for the IntersectionObserver that
  // pages older-history chunks. Lives as the FIRST child inside the
  // scroll container so scrollTop → 0 always crosses it.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Stage 4 · per-message expand toggle for messages whose text would
  // wrap past 3 lines under the -webkit-line-clamp:3 rule. Set-based
  // (id → expanded) so the panel state is O(1) per row and survives
  // channel switches inside the same session.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activeRoom = ROOMS.find((room) => room.id === activeRoomId) ?? ROOMS[0];
  const agencyAllowed = tier.tier === "agency";
  const channel = activeRoom.channel ?? "global";
  const chatEnabled = !!activeRoom.channel
    && (activeRoom.channel !== "agency-vip" || agencyAllowed);
  const {
    history,
    reload,
    loadOlder,
    isLoading,
    isLoadingOlder,
    hasMore,
    state,
    error,
  } = useChatChannel(channel, { enabled: chatEnabled });

  // Stage 4 · top-sentinel infinite scroll. When the sentinel enters
  // the scroll viewport (root = stream container) we fire loadOlder(),
  // snapshotting scrollHeight/scrollTop BEFORE the fetch so the visual
  // reader position is restored AFTER the prepend (spec §522
  // "Prepending older messages preserves the reader's visual scroll
  // position"). The observer is scoped to the current stream so a room
  // change tears it down cleanly.
  useEffect(() => {
    const scroller = streamRef.current;
    const sentinel = sentinelRef.current;
    if (!scroller || !sentinel) return;
    if (!chatEnabled) return;
    if (!hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (isLoading || isLoadingOlder) return;
        const prevScrollHeight = scroller.scrollHeight;
        const prevScrollTop = scroller.scrollTop;
        void loadOlder().then(() => {
          // Restore visual position on the next paint so the newly-
          // prepended block does not appear to "shove" the current
          // reader down the list.
          requestAnimationFrame(() => {
            const el = streamRef.current;
            if (!el) return;
            const delta = el.scrollHeight - prevScrollHeight;
            if (delta > 0) el.scrollTop = prevScrollTop + delta;
          });
        });
      },
      {
        root: scroller,
        // 80px lead-in so slow scrollers still trigger the fetch
        // before the empty header lands under the reader.
        rootMargin: "80px 0px 0px 0px",
        threshold: 0,
      },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [chatEnabled, hasMore, isLoading, isLoadingOlder, loadOlder, channel]);

  const filteredRooms = useMemo(() => {
    const needle = roomSearch.trim().toLowerCase().replace(/^#/, "");
    if (!needle) return ROOMS;
    return ROOMS.filter((room) =>
      room.label.includes(needle) || room.description.toLowerCase().includes(needle),
    );
  }, [roomSearch]);

  const send = async (): Promise<void> => {
    const content = composer.trim();
    if (!content || sending || !chatEnabled || !history.can_write) return;
    setSending(true);
    setSendError(null);
    const result = await sendChatMessageDetailed({ channel, content });
    setSending(false);
    if (!result.message) {
      setSendError(result.error ?? "Message not sent.");
      return;
    }
    setComposer("");
    setShowEmoji(false);
    setShowMedia(false);
    await reload();
    requestAnimationFrame(() => {
      const stream = streamRef.current;
      if (stream) stream.scrollTop = stream.scrollHeight;
    });
  };

  const roomCapabilityMessage = activeRoom.pendingContract
    ?? (activeRoom.channel === "agency-vip" && !agencyAllowed
      ? "Agency VIP is available only to an active Agency account."
      : null);
  const writeUnavailableTitle = roomCapabilityMessage
    ?? (!history.can_write ? "This room is read-only for your account" : undefined);

  const refresh = async (): Promise<void> => {
    if (!chatEnabled || manualRefreshing || isLoading) return;
    setManualRefreshing(true);
    await Promise.all([
      reload(),
      new Promise((resolve) => window.setTimeout(resolve, 220)),
    ]);
    setManualRefreshing(false);
    bus.emit("toast", {
      kind: "success",
      title: "Community refreshed",
      body: "Latest available messages are showing.",
    });
  };

  return (
    <Watchdog
      id="agency/ag-18/community-chat"
      label="Community chat"
      cluster="agency"
      source="design-os/community/CommunityChatHome.tsx:227"
    >
    <section className="lc-community-chat" data-testid="community-chat-home">
      <header className="lc-community-chat-head">
        <div>
          <span className="lc-community-chat-eyebrow">Community</span>
          <span className="lc-community-chat-sub">clippers · agencies · brands</span>
        </div>
        <label className="lc-community-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={roomSearch}
            onChange={(event) => setRoomSearch(event.target.value)}
            placeholder="Search rooms"
            aria-label="Search Community rooms"
          />
        </label>
      </header>

      <div className="lc-community-presence" data-presence-source="local-preference">
        <img
          src="/brand/kade/kade-community-mode.webp"
          alt="Kade · Community guide"
          className="lc-community-presence-kade"
        />
        <div className="lc-community-presence-copy">
          <span className="lc-community-presence-title">
            {visibility === "online" ? "You appear online" : "You appear invisible"}
          </span>
          <span>
            {displayName(me.snapshot?.email)} · live member count unavailable
          </span>
        </div>
        <div className="lc-community-presence-facts" aria-label="Community status">
          <span>Presence server · pending</span>
          <span>Unread totals · pending</span>
        </div>
        <button
          type="button"
          className="lc-community-presence-toggle"
          data-testid="community-presence-toggle"
          data-online={visibility === "online" ? "1" : "0"}
          aria-pressed={visibility === "online"}
          onClick={() => setVisibility(visibility === "online" ? "invisible" : "online")}
        >
          <span aria-hidden="true" />
          {visibility === "online" ? "Online" : "Invisible"}
        </button>
      </div>

      <div className="lc-community-chat-grid">
        <aside className="lc-community-room-rail" aria-label="Community rooms">
          <div className="lc-community-room-rail-title">Rooms · {ROOMS.length}</div>
          <div className="lc-community-room-list">
            {filteredRooms.map((room) => {
              const locked = room.channel === "agency-vip" && !agencyAllowed;
              const pending = !!room.pendingContract;
              return (
                <button
                  key={room.id}
                  type="button"
                  className="lc-community-room"
                  data-testid={`community-room-${room.id}`}
                  data-room-id={room.id}
                  data-active={room.id === activeRoomId}
                  data-locked={locked}
                  data-pending={pending}
                  aria-pressed={room.id === activeRoomId}
                  onClick={() => {
                    setActiveRoomId(room.id);
                    setSendError(null);
                    setShowEmoji(false);
                    setShowMedia(false);
                  }}
                >
                  <span className="lc-community-room-glyph" aria-hidden="true">
                    {locked ? "⌑" : "#"}
                  </span>
                  <span className="lc-community-room-copy">
                    <strong>{room.label}</strong>
                    <small>{room.description}</small>
                  </span>
                  <span className="lc-community-room-count" aria-label="Unread count unavailable">
                    —
                  </span>
                </button>
              );
            })}
            {filteredRooms.length === 0 && (
              <div className="lc-community-room-empty">No rooms match that search.</div>
            )}
          </div>
        </aside>

        <section
          className="lc-community-conversation"
          data-testid="community-conversation"
          aria-label={`#${activeRoom.label}`}
        >
          <header className="lc-community-conversation-head">
            <div>
              <strong>#{activeRoom.label}</strong>
              <span>
                {activeRoom.channel
                  ? state === "ready"
                    ? "Connected · member counts unavailable"
                    : state === "loading"
                      ? "Connecting…"
                      : "Connection unavailable"
                  : "Not connected to a server channel"}
              </span>
            </div>
            <button
              type="button"
              className="lc-community-refresh"
              data-testid="community-refresh"
              onClick={() => void refresh()}
              disabled={!chatEnabled || isLoading || manualRefreshing}
              aria-busy={manualRefreshing}
              title={!chatEnabled ? (roomCapabilityMessage ?? "This room is unavailable") : "Refresh messages"}
            >
              {isLoading || manualRefreshing ? "Refreshing…" : "Refresh"}
            </button>
          </header>

          <div className="lc-community-message-stream" ref={streamRef} aria-live="polite">
            {/* Stage 4 · top-sentinel target. Rendered ALWAYS as the
                first child so scrollTop → 0 crosses it deterministically;
                the IntersectionObserver is only ARMED when hasMore is
                true (see useEffect). A tiny in-flight indicator sits
                just below it while an older-history request is out. */}
            <div
              ref={sentinelRef}
              className="lc-community-load-older-sentinel"
              data-testid="community-load-older-sentinel"
              data-has-more={hasMore ? "1" : "0"}
              aria-hidden="true"
            />
            {isLoadingOlder && (
              <div
                className="lc-community-load-older-indicator"
                data-testid="community-load-older-indicator"
                role="status"
              >
                Loading older messages…
              </div>
            )}
            {roomCapabilityMessage ? (
              <div className="lc-community-capability" role="status">
                <span>Room unavailable</span>
                <strong>{roomCapabilityMessage}</strong>
                <p>No placeholder messages or member counts are being shown.</p>
              </div>
            ) : state === "loading" || state === "idle" ? (
              <div className="lc-community-loading" role="status">
                <span />
                <span />
                <span />
                Loading real messages…
              </div>
            ) : error ? (
              <div className="lc-community-capability is-error" role="alert">
                <span>{state === "offline" ? "Community offline" : "Chat unavailable"}</span>
                <strong>{error}</strong>
                <button type="button" onClick={() => void reload()}>Retry</button>
              </div>
            ) : history.messages.length === 0 ? (
              <div className="lc-community-chat-empty">
                {history.can_write
                  ? "No messages yet. Start the room."
                  : "This room is read-only for your account."}
              </div>
            ) : (
              history.messages.map((message) => {
                // Stage 4 · long-message expand. `MessageRow` (locked
                // under design-os/components) renders the content
                // inside `.lc-chat-row-content > span`; the clamp CSS
                // in `CommunityChatHome.css` targets that descendant
                // scoped to `.lc-community-message[data-expanded="0"]`
                // so the floating ChatPanel's message rows are
                // untouched. The toggle is only rendered when the raw
                // content exceeds the CLAMP_THRESHOLD_CHARS heuristic
                // so short messages never get a spurious button.
                const expanded = expandedIds.has(message.id);
                const long = (message.content?.length ?? 0) > CLAMP_THRESHOLD_CHARS;
                return (
                  <div
                    key={message.id}
                    className="lc-community-message"
                    data-testid={`community-message-${message.id}`}
                    data-expanded={expanded ? "1" : "0"}
                    data-long={long ? "1" : "0"}
                  >
                    <MessageRow
                      row={message}
                      viewerRole={history.viewer_role}
                    />
                    {long && (
                      <button
                        type="button"
                        className="lc-community-message-toggle"
                        data-testid={`community-message-toggle-${message.id}`}
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(message.id)}
                      >
                        {expanded ? "Show less" : "…more"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {showEmoji && chatEnabled && (
            <div className="lc-community-emoji-tray" data-testid="community-emoji-tray">
              {QUICK_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setComposer((value) => value + emoji)}
                  aria-label={`Add ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {showMedia && chatEnabled && (
            <MediaTray
              onClose={() => setShowMedia(false)}
              onPick={(asset) => {
                setComposer((value) => `${value}${value ? " " : ""}${asset.full_url}`);
                setShowMedia(false);
              }}
            />
          )}

          <footer className="lc-community-composer">
            <button
              type="button"
              className="lc-community-composer-tool"
              aria-label="Add emoji"
              aria-pressed={showEmoji}
              disabled={!chatEnabled || !history.can_write}
              title={writeUnavailableTitle}
              onClick={() => {
                setShowEmoji((value) => !value);
                setShowMedia(false);
              }}
            >
              ☺
            </button>
            <button
              type="button"
              className="lc-community-composer-tool"
              aria-label="Search GIFs and photos"
              aria-pressed={showMedia}
              disabled={!chatEnabled || !history.can_write}
              title={writeUnavailableTitle}
              onClick={() => {
                setShowMedia((value) => !value);
                setShowEmoji(false);
              }}
            >
              GIF
            </button>
            <textarea
              value={composer}
              maxLength={2000}
              disabled={!chatEnabled || !history.can_write || sending}
              placeholder={
                roomCapabilityMessage
                  ? "Room unavailable"
                  : history.can_write
                    ? `Message #${activeRoom.label}`
                    : "Read-only"
              }
              aria-label={`Message #${activeRoom.label}`}
              onChange={(event) => {
                setComposer(event.target.value);
                if (sendError) setSendError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="lc-community-send"
              disabled={
                !chatEnabled
                || !history.can_write
                || sending
                || composer.trim().length === 0
              }
              title={
                writeUnavailableTitle
                  ?? (composer.trim().length === 0 ? "Write a message first" : undefined)
              }
              onClick={() => void send()}
            >
              {sending ? "Sending…" : "Send"}
            </button>
            {sendError && (
              <div className="lc-community-send-error" role="alert">
                {sendError}
                <button type="button" onClick={() => void send()}>Retry</button>
              </div>
            )}
          </footer>
        </section>
      </div>
    </section>
    </Watchdog>
  );
}
