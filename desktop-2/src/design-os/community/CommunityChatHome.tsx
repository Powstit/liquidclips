import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  sendChatMessageDetailed,
  useChatChannel,
} from "../../lib/chat";
import { usePresencePreference } from "../../lib/presencePreference";
import { bus } from "../bridge";
import { useMe } from "../state/useMe";
import { useTierCaps } from "../state/useTierCaps";
import { useCommunity } from "../state/useCommunity";
import { MediaTray, MessageRow } from "../components/ChatPanel";
// ag-18 · ag-19 · 2026-07-06 · Watchdog wrap · Sovereign-Operator Protocol.
// DEMO tier: WhopChat fleet framework ready but WHOP_AGENT_ENABLED=false by
// default; chat panel + post-message surfaces are user-reachable via #/community
// so a crash inside the chat stream or composer must render KadeRepairScreen
// rather than white-screen the shell. Same wrap covers ag-18 (chat panel) and
// ag-19 (post message) — both live in this single component tree.
import { Watchdog } from "../../lib/watchdog/Watchdog";
import "./CommunityChatHome.css";

const QUICK_EMOJI = ["🔥", "👏", "💯", "🎬", "🎯", "🚀", "❤️", "😂"];

/** Stage 4 · long-message clamp threshold. `.lc-chat-row-content > span`
 *  is line-clamped to 3 lines via CSS; the Show more toggle only needs
 *  to render when the content is realistically LONG enough to wrap
 *  past 3 lines. 240 chars is a safe upper bound for typical Inter
 *  16px / 1.4 line-height inside the ~600px stream — below it the
 *  clamp never triggers so the toggle would be a lie. */
const CLAMP_THRESHOLD_CHARS = 240;

/** 2026-07-08 · Chat drift fix. Slug of the bug-tracker channel seeded
 *  by junior-backend/scripts/seed_community_channels.py. If that slug
 *  ever changes, update this constant + ALLOWED_CHANNELS in
 *  junior-backend/app/routes/chat.py in the same commit. */
const BUGS_CHANNEL_SLUG = "bugs";
/** Default fallback channel — matches the always-seeded global lounge
 *  so the drawer always has SOMETHING selected on first paint. */
const DEFAULT_CHANNEL_SLUG = "global";

function displayName(email: string | null | undefined): string {
  if (!email) return "Clipper";
  const local = email.split("@")[0]?.trim();
  return local || "Clipper";
}

/** Resolve the desktop app version + host arch so a bug report always
 *  carries the diagnostic bits Daniel needs to reproduce. Both fall
 *  back gracefully — an unknown value renders as "unknown" rather than
 *  breaking the composer. `__LC_APP_VERSION__` is injected by the
 *  Tauri shell (see desktop-2/src-tauri/tauri.conf.json → windows). */
function readAppVersion(): string {
  if (typeof window === "undefined") return "unknown";
  const winAny = window as unknown as { __LC_APP_VERSION__?: string };
  return winAny.__LC_APP_VERSION__ ?? "unknown";
}

function readArch(): string {
  if (typeof navigator === "undefined") return "unknown";
  const uaData = (navigator as unknown as {
    userAgentData?: { platform?: string; architecture?: string };
  }).userAgentData;
  if (uaData?.architecture) return uaData.architecture;
  // Fall back to the user-agent string · covers Safari/older Chromium.
  return navigator.userAgent || "unknown";
}

function buildBugReportTemplate(appVersion: string, arch: string): string {
  return (
    "Bug: [what you tried]\n" +
    "Expected: \n" +
    "Actual: \n" +
    `App version: ${appVersion}\n` +
    `Mac: ${arch}\n` +
    "---\n"
  );
}

export function CommunityChatHome(): JSX.Element {
  const tier = useTierCaps();
  const me = useMe();
  const { visibility, setVisibility } = usePresencePreference();
  const community = useCommunity();
  const [activeRoomSlug, setActiveRoomSlug] = useState<string>(DEFAULT_CHANNEL_SLUG);
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

  /* ------------------------------------------------------------------
   * Room list · live from /community/channels via useCommunity().
   *
   * 2026-07-08 · Chat drift fix. Previously this component shipped a
   * hard-coded 5-room array with three "server rollout pending" strings
   * that had no backend counterpart, so real users saw fake rooms and
   * thought chat was broken. useCommunity() reads the seeded
   * community_channels table (9 rooms after the seed script picks up
   * the new #bugs row = 10 rooms total) so the drawer stays in sync
   * with what the backend actually stores.
   * ------------------------------------------------------------------ */

  /* Fallback while useCommunity() is loading or has erred — keeps the
   * always-seeded #global lounge selectable so the composer works even
   * if /community/channels 500s. */
  const fallbackRoom = useMemo(
    () => ({
      slug: DEFAULT_CHANNEL_SLUG,
      label: DEFAULT_CHANNEL_SLUG,
      description: "Open community chat",
      locked: false,
    }),
    [],
  );

  interface RoomView {
    slug: string;
    label: string;
    description: string;
    locked: boolean;
    /** BC-013 locked layout · pending rooms appear in the sidebar so
     *  the customer can see + request access even before the backend
     *  registers a channel row. Rendered with data-pending="true" so
     *  the community-chat-home contract can distinguish connected vs
     *  pending. */
    pending?: boolean;
  }

  /* BC-013 (2026-07-12) · pending-room seed. The backend
   * community_channels table doesn't yet include every room the
   * locked layout promises (clippers-lounge · agency-vip). Rather
   * than showing a single #global sidebar and stranding the user,
   * surface both pending rooms with data-pending="true" so they
   * can see + request access. Clicking a pending room lands on the
   * "This room needs a backend channel before messages can be
   * stored" honesty copy (already rendered downstream). */
  const pendingRooms: RoomView[] = useMemo(
    () => [
      {
        slug: "clippers-lounge",
        label: "clippers-lounge",
        description: "Free clippers lounge · access pending",
        locked: true,
        pending: true,
      },
      {
        slug: "agency-vip",
        label: "agency-vip",
        description: "Agency VIP · Agency account required",
        locked: true,
        pending: true,
      },
    ],
    [],
  );

  const rooms = useMemo<RoomView[]>(() => {
    const seen = new Set<string>();
    const out: RoomView[] = [];
    if (community.rooms.length === 0) {
      out.push(fallbackRoom);
      seen.add(fallbackRoom.slug);
    } else {
      for (const r of community.rooms) {
        if (seen.has(r.channel.slug)) continue;
        out.push({
          slug: r.channel.slug,
          label: r.channel.slug,
          description: r.channel.purpose ?? r.channel.name,
          locked: r.locked,
        });
        seen.add(r.channel.slug);
      }
    }
    for (const p of pendingRooms) {
      if (seen.has(p.slug)) continue;
      out.push(p);
      seen.add(p.slug);
    }
    return out;
  }, [community.rooms, fallbackRoom, pendingRooms]);

  const activeRoom = rooms.find((r) => r.slug === activeRoomSlug) ?? rooms[0];
  const channel = activeRoom.slug;
  /* A room is chat-write-enabled unless the backend has told us the
   * caller's tier can't post to it. Read is still gated by the backend
   * response — a locked-preview room comes back as read-only. */
  const chatEnabled = !activeRoom.locked;
  const {
    history,
    reload,
    loadOlder,
    isLoading,
    isLoadingOlder,
    hasMore,
    state,
    error,
    onlineCount,
  } = useChatChannel(channel, { enabled: chatEnabled, viewerUserId: me.snapshot?.userId });

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
    if (!needle) return rooms;
    return rooms.filter((room) =>
      room.label.toLowerCase().includes(needle)
        || room.description.toLowerCase().includes(needle),
    );
  }, [rooms, roomSearch]);

  /* Bug-report CTA. Jumps to #bugs (or stays there if already active)
   * and pre-fills the composer with a diagnostic template. Composer
   * focus follows so the user can start typing immediately. */
  const reportBug = useCallback(() => {
    const appVersion = readAppVersion();
    const arch = readArch();
    const template = buildBugReportTemplate(appVersion, arch);
    setActiveRoomSlug(BUGS_CHANNEL_SLUG);
    setComposer(template);
    setShowEmoji(false);
    setShowMedia(false);
    setSendError(null);
    // Focus the composer after the room-switch render lands so the
    // caret is placed inside the template (state reset happens in the
    // useChatChannel effect, which fires after this handler returns).
    requestAnimationFrame(() => {
      const stream = streamRef.current?.parentElement;
      const textarea = stream?.querySelector<HTMLTextAreaElement>(
        ".lc-community-composer textarea",
      );
      if (textarea) {
        textarea.focus();
        // Drop the caret AT THE TOP of the template so the user's
        // first keystroke lands on the "[what you tried]" placeholder.
        textarea.setSelectionRange(5, 22);
      }
    });
  }, []);

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

  /* BC-013 (2026-07-12) · pending rooms get their own honest copy so
   * a Free/Solo user who clicks clippers-lounge or agency-vip lands
   * on a message that explains the state instead of the generic
   * "requires a paid plan" that only fits the tier-gated case. */
  const roomCapabilityMessage = activeRoom.pending
    ? activeRoom.slug === "agency-vip"
      ? "Agency VIP is available only to an active Agency account."
      : "This room needs a backend channel before messages can be stored."
    : activeRoom.locked
      ? "This room requires a paid plan."
      : null;
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

  // ag-agency badge parity retained · the composer/emoji/media guards
  // still consult tier for the agency-vip lounge downstream in
  // useChatChannel; nothing here needs the pre-computed flag anymore
  // now that the room list ships from useCommunity().
  void tier;

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
            {displayName(me.snapshot?.email)}
            {" · "}
            {onlineCount === null
              ? "connecting…"
              : `${onlineCount} online in #${activeRoom.slug}`}
          </span>
        </div>
        <div className="lc-community-presence-facts" aria-label="Community status">
          {/* 2026-07-08 · Chat drift fix. Bug-report CTA jumps to #bugs
              and pre-fills the composer with a diagnostics template so
              a real user can report a bug without leaving the app. */}
          <button
            type="button"
            className="lc-community-report-bug"
            data-testid="community-report-bug"
            onClick={reportBug}
          >
            🐛 Report a bug
          </button>
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
          <div className="lc-community-room-rail-title">Rooms · {rooms.length}</div>
          <div
            className="lc-community-room-list"
            data-testid="community-room-list"
            data-room-count={rooms.length}
          >
            {community.loading && community.rooms.length === 0 ? (
              /* Loading state · skeleton rows so the drawer doesn't
                 collapse while /community/channels is in flight. */
              <div
                className="lc-community-room-loading"
                data-testid="community-room-loading"
                role="status"
              >
                <span /><span /><span />
                Loading rooms…
              </div>
            ) : community.error && community.rooms.length === 0 ? (
              /* Error state · surfaces the failure + a support email so
                 the user isn't stranded when the backend is unreachable. */
              <div
                className="lc-community-room-error"
                data-testid="community-room-error"
                role="alert"
              >
                <strong>Couldn't load rooms</strong>
                <span>{community.error}</span>
                <a href="mailto:support@liquidclips.app">support@liquidclips.app</a>
                <button type="button" onClick={() => void community.reload()}>
                  Retry
                </button>
              </div>
            ) : filteredRooms.length === 0 && rooms.length > 0 ? (
              <div className="lc-community-room-empty">No rooms match that search.</div>
            ) : rooms.length === 0 ? (
              <div className="lc-community-room-empty" data-testid="community-room-empty">
                No channels yet — refresh in a moment.
              </div>
            ) : (
              filteredRooms.map((room) => {
                const locked = room.locked;
                const pending = room.pending === true;
                return (
                  <button
                    key={room.slug}
                    type="button"
                    className="lc-community-room"
                    data-testid={`community-room-${room.slug}`}
                    data-room-id={room.slug}
                    data-active={room.slug === activeRoomSlug}
                    data-locked={locked}
                    data-pending={pending ? "true" : undefined}
                    aria-pressed={room.slug === activeRoomSlug}
                    onClick={() => {
                      setActiveRoomSlug(room.slug);
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
              })
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
                {state === "ready"
                  ? "Connected · member counts unavailable"
                  : state === "loading"
                    ? "Connecting…"
                    : "Connection unavailable"}
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
