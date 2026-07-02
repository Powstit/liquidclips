import { useMemo, useRef, useState } from "react";
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

  const activeRoom = ROOMS.find((room) => room.id === activeRoomId) ?? ROOMS[0];
  const agencyAllowed = tier.tier === "agency";
  const channel = activeRoom.channel ?? "global";
  const chatEnabled = !!activeRoom.channel
    && (activeRoom.channel !== "agency-vip" || agencyAllowed);
  const { history, reload, isLoading, state, error } = useChatChannel(channel, {
    enabled: chatEnabled,
  });

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
              history.messages.map((message) => (
                <MessageRow
                  key={message.id}
                  row={message}
                  viewerRole={history.viewer_role}
                />
              ))
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
  );
}
