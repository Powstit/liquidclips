// ship-lens v0.7.8 P1+P4 — Two fixes:
//   P1: handle the new "unlinked" channel status (TikTok revoked our access)
//       distinct from "pending_link" (never finished OAuth). The deep-link
//       handler toasts "Disconnected — reconnect" when the post-OAuth refresh
//       lands a row in `unlinked`, and the popover row renders with the
//       reconnect hint instead of the bind-as-usual styling.
//   P4: every non-deleted channel in the popover renders with a status-
//       aware disabled state + hint. Active rows toggle; error / paused /
//       pending_link / unlinked rows are inert (not bindable) and surface
//       the recovery hint in their tooltip and inline badge instead of
//       letting the user bind a channel that can't actually publish.
//
// Per-window account-binding chip.
//
// Renders a tiny clickable chip on each workbench window header that shows
// which channels that window will fan out to when scheduled. Click → popover
// with a checklist of every channel from the user's account.
//
// SERVES (per UI_MAP_workbench.md):
//   • Workbench surface: `(O #2)` "I want this clip on these platforms"
//     — the avatar stack on the window header is the persistent proof of
//     which platforms this window is bound to.
//   • Connect-channel flow surface: `(O #2)(O #4)` — the popover's empty
//     state hosts the "Connect Instagram" / "Connect TikTok" buttons
//     (one-click connect) and the inline "Waiting for browser…" interim-
//     proof state. After the deep link fires, this chip refreshes its
//     channel list and emits the global success toast (O #4).
//
// VISUAL VOCABULARY — matches the existing cockpit/scheduler language:
//   • fuchsia border, transparent fill
//   • font-mono [10px] uppercase tracking-[0.16em] labels
//   • cockpit-tile-corner brackets on the popover
//   • PlatformIcon for known platforms, mono fallback glyph for new ones
//
// EMPTY-STATE: when no channels exist at all, we don't dead-end the user
// inside the popover. We surface Connect Instagram / Connect TikTok
// buttons in-place (one-click connect, per the contract) AND a fallback
// link to Settings → Connections for everything else.
//
// PERSISTENCE: store.bindChannels writes through to localStorage via the
// existing persistedSession debounce (Agent 1) — bindings survive reboot.

import { useEffect, useMemo, useRef, useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { humanError } from "../../lib/sidecar";
import { useWorkbenchStore } from "./useWorkbenchStore";
import {
  createChannel,
  listChannels,
  refreshChannel,
  type Channel,
  type ChannelPlatform,
} from "../../lib/backend";
import type { WindowId } from "./types";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import windowEmptyBindUrl from "../../assets/workbench/window-empty-bind.png";

// 90s matches the Connect-channel flow contract: any longer and the user
// is staring at a spinner with no signal that anything went wrong.
const CONNECT_TIMEOUT_MS = 90_000;

function platformLabel(p: ChannelPlatform): string {
  switch (p) {
    case "instagram": return "Instagram";
    case "tiktok":    return "TikTok";
    case "youtube":   return "YouTube";
    case "x":         return "X";
    case "linkedin":  return "LinkedIn";
    case "facebook":  return "Facebook";
    case "threads":   return "Threads";
  }
}

function emitToast(kind: "success" | "error" | "info", message: string): void {
  // Reuses the app-wide `lc:toast` bus mounted by GlobalToastHost — no new
  // dependencies, no per-surface toast widget.
  window.dispatchEvent(
    new CustomEvent("lc:toast", { detail: { kind, message } }),
  );
}

// The four platforms PlatformIcon ships glyphs for. Anything else falls
// back to a mono first-letter pill (same pattern as InlineScheduler line
// ~567 — `known` check).
const KNOWN_PLATFORM_IDS: ReadonlySet<string> = new Set<PlatformId>([
  "youtube",
  "tiktok",
  "instagram",
  "x",
]);

function isKnownPlatform(p: string): p is PlatformId {
  return KNOWN_PLATFORM_IDS.has(p);
}

/** Small avatar glyph for a single channel — used in the stack AND the
 *  popover row. Mono fallback when PlatformIcon doesn't ship the glyph. */
function ChannelAvatar({
  channel,
  size = "h-5 w-5",
  iconSize = "h-2.5 w-2.5",
}: {
  channel: Channel;
  size?: string;
  iconSize?: string;
}) {
  const platform = channel.platform;
  return (
    <span
      className={`grid place-items-center rounded-full bg-ink text-paper ${size}`}
      aria-label={`${platform} ${channel.label}`}
    >
      {isKnownPlatform(platform) ? (
        <PlatformIcon id={platform} className={iconSize} />
      ) : (
        <span className="font-mono text-[8px] uppercase">
          {platform[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </span>
  );
}

export function AccountBindingChip({ windowId }: { windowId: WindowId }) {
  // Per-window selector keeps re-renders tight: only this chip re-runs when
  // its own boundChannelIds change. Falls back to [] so a transient missing
  // window (e.g. mid-remove) doesn't crash the chrome bar.
  const boundChannelIds = useWorkbenchStore(
    (s) => s.windows.get(windowId)?.boundChannelIds ?? [],
  );
  const bindChannels = useWorkbenchStore((s) => s.bindChannels);

  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Inline "Waiting for browser…" state for the per-popover Connect
  // Instagram / Connect TikTok buttons. `connecting.timedOut` flips when
  // the 90s timer fires so we can show the "Still waiting — try Reconnect"
  // copy without losing the connecting context. `pendingChannelId` is the
  // channel just created (still pending_link until OAuth completes) so the
  // deep-link listener can target the right row when it refreshes.
  const [connecting, setConnecting] = useState<{
    platform: ChannelPlatform;
    channelId: string | null;
    timedOut: boolean;
  } | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearConnectTimer() {
    if (connectTimerRef.current != null) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }

  // Channel lookup map — selecting from boundChannelIds without scanning the
  // whole list every render.
  const channelsById = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels ?? []) m.set(c.id, c);
    return m;
  }, [channels]);

  const boundChannels = useMemo(() => {
    const out: Channel[] = [];
    for (const id of boundChannelIds) {
      const c = channelsById.get(id);
      if (c) out.push(c);
    }
    return out;
  }, [boundChannelIds, channelsById]);

  // Fetch only when the popover opens. PREVENTS an N-windows = N parallel
  // /channels fetches stampede on workbench mount. Re-fetch on every open
  // so a user who connects a channel in Settings sees it without restarting.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadState("loading");
    setErrorMsg(null);
    (async () => {
      try {
        const list = await listChannels();
        if (cancelled) return;
        // ship-lens v0.7.8 P4 — Surface every non-deleted channel; the row
        // rendering below disables non-active rows with a status-aware hint
        // so the user knows what to do (vs. seeing the row disappear).
        setChannels(list.filter((c) => c.status !== "deleted"));
        setLoadState("loaded");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(humanError(e) || "Couldn't load channels.");
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Dismiss the popover on outside click / Esc. PREVENTS keyboard trap and
  // the "click another window's chip, both popovers open" race.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Deep-link subscriber. `activation.ts` dispatches `junior:channel-linked`
  // whenever the browser bounces back via `liquidclips://channel-linked`
  // after Ayrshare OAuth completes. We refresh the affected channel and
  // re-fetch the full list so the chip flips state (and the popover, if
  // still open, shows the freshly active row). When the just-connected
  // channel belongs to THIS window's connecting flow, we also drop a
  // global success toast and dismiss the inline waiting state.
  useEffect(() => {
    async function onLinked(ev: Event) {
      const detail = (ev as CustomEvent<{ channelId: string | null }>).detail ?? { channelId: null };
      const cid = detail.channelId;
      let refreshed: Channel | null = null;
      if (cid) {
        try {
          refreshed = await refreshChannel(cid);
        } catch {
          /* server-side refresh failed — listChannels below still gives
             us the latest snapshot, just without the immediate flip. */
        }
      }
      try {
        const list = await listChannels();
        // ship-lens v0.7.8 P4 — same non-deleted filter as the initial load.
        setChannels(list.filter((c) => c.status !== "deleted"));
        setLoadState("loaded");
        // Only this window's connecting flow owns the toast — multiple
        // mounted chips across windows would otherwise all fire on the
        // same event. ChannelsManager owns the global "no chip mounted"
        // case (per the contract).
        if (connecting && (connecting.channelId === cid || cid === null)) {
          const target = refreshed
            ?? (cid ? list.find((c) => c.id === cid) ?? null : null);
          if (target && target.status === "active") {
            const handle = target.handle ? `@${target.handle}` : target.label;
            emitToast(
              "success",
              `${platformLabel(target.platform)} connected as ${handle}`,
            );
          } else if (target && target.status === "unlinked") {
            // ship-lens v0.7.8 P1 — A link attempt that lands on `unlinked`
            // means the platform refused / revoked us — call that out
            // explicitly instead of saying "try Reconnect" which sounds
            // like our error.
            emitToast(
              "error",
              `${platformLabel(target.platform)} disconnected — reconnect from Settings`,
            );
          } else if (target && target.status === "pending_link") {
            emitToast(
              "error",
              `Couldn't confirm ${platformLabel(target.platform)} link — try Reconnect`,
            );
          }
          clearConnectTimer();
          setConnecting(null);
        }
      } catch {
        /* swallow — the popover's load-state path handles surfaced
           errors; a silent failure here is preferable to a phantom toast. */
      }
    }
    window.addEventListener("junior:channel-linked", onLinked as EventListener);
    return () => {
      window.removeEventListener("junior:channel-linked", onLinked as EventListener);
    };
  }, [connecting]);

  // Unmount safety — never leak a pending timeout into a remounted chip
  // that would emit a "stuck" toast for a connection the user already
  // closed.
  useEffect(() => () => clearConnectTimer(), []);

  async function startConnect(platform: ChannelPlatform) {
    // Optimistic state so the click feels instant; we'll either replace it
    // with the real channel id once createChannel resolves, or clear it on
    // error.
    setConnecting({ platform, channelId: null, timedOut: false });
    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      setConnecting((cur) =>
        cur && cur.platform === platform ? { ...cur, timedOut: true } : cur,
      );
    }, CONNECT_TIMEOUT_MS);

    try {
      const { channel, link_url } = await createChannel({
        platform,
        label: platformLabel(platform),
      });
      setConnecting({ platform, channelId: channel.id, timedOut: false });
      await openExternal(link_url);
    } catch (e) {
      clearConnectTimer();
      setConnecting(null);
      emitToast(
        "error",
        humanError(e) || `Couldn't start ${platformLabel(platform)} connect — try again.`,
      );
    }
  }

  function cancelConnecting() {
    clearConnectTimer();
    setConnecting(null);
  }

  function toggleChannel(id: string) {
    const next = boundChannelIds.includes(id)
      ? boundChannelIds.filter((x) => x !== id)
      : [...boundChannelIds, id];
    bindChannels(windowId, next);
  }

  const hasBindings = boundChannelIds.length > 0;
  const visible = boundChannels.slice(0, 3);
  const overflow = boundChannels.length - visible.length;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          hasBindings
            ? `Bound to ${boundChannelIds.length} channel${boundChannelIds.length === 1 ? "" : "s"} — tap to edit`
            : "Tap to bind channels"
        }
        title={
          hasBindings
            ? `${boundChannelIds.length} channel${boundChannelIds.length === 1 ? "" : "s"} bound`
            : "Tap to bind channels"
        }
        className={
          hasBindings
            ? "inline-flex items-center gap-1 rounded-full border border-fuchsia/60 bg-paper-elev/60 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia transition-colors hover:border-fuchsia hover:bg-fuchsia/10"
            : "inline-flex items-center gap-1.5 rounded-full border-2 border-fuchsia bg-fuchsia/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia shadow-[0_0_10px_rgba(255,26,140,0.45)] transition-all hover:bg-fuchsia/25"
        }
      >
        {hasBindings ? (
          <>
            <span className="flex -space-x-1.5">
              {boundChannels.length === 0
                ? // Bindings exist by id but channel list hasn't loaded yet —
                  // show a neutral count so we don't render an empty stack
                  // that looks like "tap to bind" again.
                  null
                : visible.map((c) => (
                    <ChannelAvatar key={c.id} channel={c} />
                  ))}
            </span>
            {overflow > 0 && <span className="ml-0.5">+{overflow}</span>}
            {boundChannels.length === 0 && (
              <span>{boundChannelIds.length} bound</span>
            )}
          </>
        ) : (
          <>
            <img
              src={windowEmptyBindUrl}
              alt=""
              aria-hidden
              className="h-3.5 w-3.5"
            />
            <span>tap to bind</span>
          </>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Bind channels to this window"
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-72 rounded-xl border border-fuchsia/40 bg-paper p-3 shadow-[0_12px_36px_rgba(0,0,0,0.45)]"
        >
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia">
              bind channels
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary hover:text-ink"
            >
              close
            </button>
          </div>

          {loadState === "loading" || loadState === "idle" ? (
            <p className="font-mono text-[11px] text-text-tertiary">
              reading channels…
            </p>
          ) : loadState === "error" ? (
            <div className="flex flex-col gap-2">
              <p className="font-sans text-[12px] text-[var(--color-danger)]">
                {errorMsg ?? "Couldn't read your channels."}
              </p>
              <button
                type="button"
                onClick={() => {
                  // Re-trigger the fetch effect by toggling the open flag.
                  setLoadState("idle");
                  setOpen(false);
                  // Re-open on the next tick so the effect re-runs.
                  setTimeout(() => setOpen(true), 0);
                }}
                className="inline-flex w-fit items-center rounded-full border border-fuchsia/40 bg-paper-elev px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia hover:bg-fuchsia/10"
              >
                retry
              </button>
            </div>
          ) : channels && channels.length === 0 ? (
            // STRANDS guard: a user with zero channels would otherwise see
            // an empty popover with no way forward. Per the Connect-channel
            // flow contract: one-click Connect Instagram / Connect TikTok
            // here, with an inline "Waiting for browser…" state + 90s
            // timeout. Settings → Connections stays as the catch-all link
            // for other platforms / re-link / diagnose.
            <div className="flex flex-col gap-3">
              {connecting ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex flex-col gap-2 rounded-lg border border-fuchsia/40 bg-fuchsia/10 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {!connecting.timedOut && (
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-fuchsia border-t-transparent"
                      />
                    )}
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fuchsia">
                      {connecting.timedOut
                        ? `Still waiting — try Reconnect`
                        : `Waiting for browser…`}
                    </span>
                  </div>
                  <p className="font-sans text-[12px] text-text-secondary">
                    {connecting.timedOut
                      ? `Finish ${platformLabel(connecting.platform)} sign-in in your browser, then click Reconnect.`
                      : `Finish ${platformLabel(connecting.platform)} sign-in in your browser — we'll flip this chip the moment it lands.`}
                  </p>
                  <button
                    type="button"
                    onClick={cancelConnecting}
                    className="inline-flex w-fit items-center rounded-full border border-fuchsia/40 bg-paper-elev px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia hover:bg-fuchsia/10"
                  >
                    {connecting.timedOut ? "reconnect" : "cancel"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-sans text-[12px] text-text-secondary">
                    No channels yet — connect one to start scheduling clips.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => void startConnect("instagram")}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia bg-fuchsia/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fuchsia hover:bg-fuchsia/25"
                    >
                      <PlatformIcon id="instagram" className="h-3 w-3" />
                      Connect Instagram
                    </button>
                    <button
                      type="button"
                      onClick={() => void startConnect("tiktok")}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia bg-fuchsia/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fuchsia hover:bg-fuchsia/25"
                    >
                      <PlatformIcon id="tiktok" className="h-3 w-3" />
                      Connect TikTok
                    </button>
                  </div>
                  <p className="font-mono text-[11px] text-text-tertiary">
                    Need YouTube, X, or another platform? Open Settings → Connections.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
              {channels!.map((channel) => {
                const selected = boundChannelIds.includes(channel.id);
                // ship-lens v0.7.8 P4 — Per-status view model: only active
                // channels are bindable; everything else renders disabled
                // with a status-specific hint. Same language as the
                // InlineScheduler + ChannelPicker chips so the user gets
                // the SAME copy across every surface that shows channels.
                const row = rowViewFor(channel.status);
                const isActive = row.kind === "active";
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => toggleChannel(channel.id)}
                    disabled={!isActive}
                    aria-pressed={isActive ? selected : undefined}
                    title={
                      isActive
                        ? `${channel.platform} · ${channel.handle ?? channel.label}`
                        : `${channel.platform} · ${channel.label} — ${row.hint}`
                    }
                    className={
                      isActive
                        ? selected
                          ? "flex items-center gap-2 rounded-lg border border-fuchsia bg-fuchsia/15 px-2 py-1.5 text-left font-sans text-[12px] text-fuchsia"
                          : "flex items-center gap-2 rounded-lg border border-line bg-paper-elev px-2 py-1.5 text-left font-sans text-[12px] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                        : row.kind === "unlinked" || row.kind === "error"
                        ? "flex cursor-not-allowed items-center gap-2 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-2 py-1.5 text-left font-sans text-[12px] text-[var(--color-danger)] opacity-80"
                        : row.kind === "paused"
                        ? "flex cursor-not-allowed items-center gap-2 rounded-lg border border-text-tertiary/40 bg-text-tertiary/5 px-2 py-1.5 text-left font-sans text-[12px] text-text-tertiary opacity-80"
                        : "flex cursor-not-allowed items-center gap-2 rounded-lg border border-fuchsia-deep/40 bg-fuchsia-deep/5 px-2 py-1.5 text-left font-sans text-[12px] text-fuchsia-deep opacity-90"
                    }
                  >
                    <ChannelAvatar channel={channel} />
                    <span className="min-w-0 flex-1 truncate">{channel.label}</span>
                    <span
                      aria-hidden
                      className={
                        isActive
                          ? selected
                            ? "font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia"
                            : "font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                          : row.kind === "unlinked" || row.kind === "error"
                          ? "font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-danger)]"
                          : row.kind === "paused"
                          ? "font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                          : "font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia-deep"
                      }
                    >
                      {isActive ? (selected ? "on" : "off") : row.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ship-lens v0.7.8 P1+P4 — Per-status view model for a non-active channel
// row. badge = inline label; hint = tooltip / aria description. The copy
// here mirrors ChannelPicker (v0.7.7 #7) + InlineScheduler (v0.7.8 P3) so
// every surface that shows channels uses the same words.
type RowView =
  | { kind: "active" }
  | { kind: "pending"; badge: string; hint: string }
  | { kind: "unlinked"; badge: string; hint: string }
  | { kind: "error"; badge: string; hint: string }
  | { kind: "paused"; badge: string; hint: string }
  | { kind: "unknown"; badge: string; hint: string };

function rowViewFor(status: Channel["status"]): RowView {
  switch (status) {
    case "active":
      return { kind: "active" };
    case "pending_link":
      return {
        kind: "pending",
        badge: "finish linking",
        hint: "Finish linking this channel in Settings before binding",
      };
    case "unlinked":
      // ship-lens v0.7.8 P1 — Platform-side revoke. NOT "pending" — the
      // user did finish the OAuth once; the platform has since cut us off.
      return {
        kind: "unlinked",
        badge: "disconnected",
        hint: "Disconnected — reconnect from Settings → Connections",
      };
    case "error":
      return {
        kind: "error",
        badge: "reconnect",
        hint: "This channel needs to be reconnected — open Settings → Connections",
      };
    case "paused":
      return {
        kind: "paused",
        badge: "paused",
        hint: "Paused — resume in Settings → Connections before binding",
      };
    default:
      return { kind: "unknown", badge: status, hint: `Status: ${status}` };
  }
}
